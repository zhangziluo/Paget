"""Tests for the built-in PDF extractor (``wreader.pdf``).

Every sample file is built **here**, as a synthetic PDF, so the suite never
depends on a real book on the developer's disk.  Each layer gets its own test:
the object/stream parser, the filters (Flate / ASCIIHex / ASCII85 / predict),
the cross reference *stream* and object stream path, the scan fallback for a
broken file, the font maps (``/ToUnicode`` CMaps, ``/Encoding``, TrueType
widths), the text operators, covers, ``/Info`` metadata and the ``library``
integration behind ``load_source_text``.
"""

# 延迟求值类型注解
from __future__ import annotations

# 造 ASCII85 测试数据时跟标准库对一遍
import base64
# 压缩内容流
import zlib
# 路径
from pathlib import Path
# 类型注解
from typing import Dict, List, Sequence, Tuple

# pytest 的 raises / monkeypatch
import pytest

# 被测模块
from wreader import library, pdf, serve


# --------------------------------------------------------------------------
# 造一个最小 PDF（传统 xref 表的那种写法）
# --------------------------------------------------------------------------
class _Builder:
    """Collect indirect objects and hand back their numbers."""

    def __init__(self) -> None:
        # 对象体：第 N 个就是对象号 N（下标 0 = 对象 1）
        self.bodies: List[bytes] = []

    def add(self, body: bytes) -> int:
        """Add one direct object body and return its object number."""
        # 对象号从 1 开始
        self.bodies.append(body)
        return len(self.bodies)

    def stream(self, extra: bytes, data: bytes) -> int:
        """Add a stream object; *extra* is the dictionary minus ``/Length``."""
        # /Length 由这里补上，调用方只管字典的其余部分
        body = b"<< " + extra + b" /Length %d >>\nstream\n" % len(data) + data + b"\nendstream"
        return self.add(body)

    def finish(self, root: int, info: int = 0, extra_trailer: bytes = b"") -> bytes:
        """Assemble the file: header, objects, xref table, trailer."""
        data = bytearray(b"%PDF-1.7\n")
        offsets: List[int] = []
        # 每个对象前先记下它的偏移（xref 表要用）
        for index, body in enumerate(self.bodies, start=1):
            offsets.append(len(data))
            data += b"%d 0 obj\n" % index + body + b"\nendobj\n"
        start = len(data)
        # 交叉引用表：一条空闲头 + 每个对象一条
        count = len(self.bodies) + 1
        data += b"xref\n0 %d\n" % count
        data += b"0000000000 65535 f \n"
        for offset in offsets:
            data += b"%010d 00000 n \n" % offset
        # trailer：/Root 是目录，/Info 可选
        trailer = b"<< /Size %d /Root %d 0 R " % (count, root)
        if info:
            trailer += b"/Info %d 0 R" % info
        trailer += extra_trailer + b">>"
        data += b"trailer\n" + trailer + b"\nstartxref\n%d\n%%%%EOF\n" % start
        return bytes(data)


def _simple_font() -> bytes:
    """A Type1 font with a full ASCII ``/Widths`` array (500 = half an em)."""
    # 32..126 一共 95 个码位，每个宽度都写成 500
    widths = b" ".join([b"500"] * 95)
    return (
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica"
        b" /Encoding /WinAnsiEncoding /FirstChar 32 /Widths [" + widths + b"] >>"
    )


def _one_page_pdf(content: bytes, extra_resources: bytes = b"", compressed: bool = False) -> bytes:
    """A single page PDF whose page draws *content* with one Helvetica font.

    The object numbers are fixed by construction -- 1 font, 2 contents, 3 page,
    4 ``/Pages``, 5 catalog -- which is what lets the page point at its parent
    without a second pass.
    """
    # 1 号是字体，2 号是内容流，3 号是页，4 号是页树，5 号是目录
    payload = zlib.compress(content) if compressed else content
    filters = b" /Filter /FlateDecode" if compressed else b""
    resources = b"<< /Font << /F1 1 0 R >> " + extra_resources + b">>"
    builder = _Builder()
    builder.add(_simple_font())
    builder.add(
        b"<< /Length %d" % len(payload) + filters + b" >>\nstream\n" + payload + b"\nendstream"
    )
    builder.add(
        b"<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources " + resources
        + b" /Contents 2 0 R >>"
    )
    builder.add(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    builder.add(b"<< /Type /Catalog /Pages 4 0 R >>")
    return builder.finish(5)


def _write(tmp_path: Path, name: str, payload: bytes) -> Path:
    """Write *payload* into the test's temporary directory."""
    target = tmp_path / name
    target.write_bytes(payload)
    return target


# --------------------------------------------------------------------------
# 正文：内容流里的文字操作符
# --------------------------------------------------------------------------
def test_extracts_a_simple_latin_page(tmp_path: Path) -> None:
    """A ``Tj`` on a WinAnsi page comes out as exactly that text."""
    content = b"BT /F1 24 Tf 72 700 Td (Hello World) Tj ET"
    source = _write(tmp_path, "simple.pdf", _one_page_pdf(content))
    assert pdf.extract_text(source) == "Hello World"


def test_a_flate_compressed_content_stream_works_too(tmp_path: Path) -> None:
    """The same page with a ``/FlateDecode`` content stream reads the same."""
    content = b"BT /F1 24 Tf 72 700 Td (Compressed) Tj ET"
    source = _write(tmp_path, "flate.pdf", _one_page_pdf(content, compressed=True))
    assert pdf.extract_text(source) == "Compressed"


def test_line_breaks_come_from_the_text_position(tmp_path: Path) -> None:
    """Two ``Td`` moves down the page become two lines, not one."""
    # 第一行在 y=700，第二行用 T* 换行（行距 30）
    content = b"BT /F1 12 Tf 30 TL 72 700 Td (first line) Tj T* (second line) Tj ET"
    source = _write(tmp_path, "lines.pdf", _one_page_pdf(content))
    assert pdf.extract_text(source).split("\n") == ["first line", "second line"]


def test_ascii_hex_and_ascii85_filters() -> None:
    """The two ASCII filters decode what the standard library says they should."""
    # <48656C6C6F> 就是 "Hello"
    assert pdf._ascii_hex_decode(b"<48656C6C6F>", {}) == b"Hello"
    # 奇数个十六进制位按规范末尾补 0
    assert pdf._ascii_hex_decode(b"48656C6C6F7", {}) == bytes.fromhex("48656C6C6F70")
    # ASCII85：拿标准库当参照物（adobe=True 的封装与我们支持的一致）
    for payload in (b"Hello", b"Hi", b"", b"\x00\x00\x00\x00zero"):
        encoded = base64.a85encode(payload, adobe=True)
        assert pdf._ascii85_decode(encoded, {}) == payload


def test_run_length_and_lzw_filters() -> None:
    """RunLength and LZW are small enough to spell out the code stream by hand."""
    # RunLength：<2> 表示后面 3 个字节原文；<FE> 表示下 1 个字节重复 3 次；<80> 收尾
    assert pdf._run_length_decode(b"\x02abc\xfeX\x80", {}) == b"abcXXX"
    # LZW：清表 + 三个字面量码 + 结束码，9 位一码（按位大端拼，右边补齐）
    codes = [256, 0x61, 0x62, 0x63, 257]
    bits = "".join(format(code, "09b") for code in codes)
    bits += "0" * (-len(bits) % 8)
    packed = int(bits, 2).to_bytes(len(bits) // 8, "big")
    assert pdf._lzw_decode(packed, {}) == b"abc"


def test_png_predictor_round_trip() -> None:
    """``/Predictor`` (PNG Sub) is undone correctly."""
    # 原始行 [10, 20, 30] 用 Sub 预测编码后是 [10, 10, 10]（每格减去左边一格）
    decoded = pdf._apply_predictor(b"\x01\x0a\x0a\x0a", {"Predictor": 12, "Columns": 3, "Colors": 1})
    assert decoded == bytes([10, 20, 30])
    # Predictor 1（不预测）原样返回
    assert pdf._apply_predictor(b"as-is", {"Predictor": 1}) == b"as-is"


# --------------------------------------------------------------------------
# 字体：码位到文字的映射，以及宽度
# --------------------------------------------------------------------------
def _inline(document: pdf._Document, source: bytes) -> Dict[object, object]:
    """Parse an inline dictionary with the module's own parser."""
    # 复用被测的解析器：测试数据不必另写一套字典解析
    value = pdf._Parser(source).parse_object()
    assert isinstance(value, dict)
    return value


def _cjk_page_pdf() -> bytes:
    """One page whose text uses a Type0 (Identity-H) font with a /ToUnicode CMap.

    The CMap exercises both spellings: ``bfchar`` for two characters and
    ``bfrange`` for a run (once sequential, once with an explicit target array) --
    which is exactly how a real Chinese book maps its subset font.
    """
    cmap = (
        b"/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n"
        b"1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
        b"2 beginbfchar\n<0003> <4E2D>\n<0004> <6587>\nendbfchar\n"
        b"2 beginbfrange\n<0010> <0012> <0061>\n<0020> <0022> [<0041> <0042> <0043>]\nendbfrange\n"
        b"endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n"
    )
    content = b"BT /F1 24 Tf 72 700 Td <0003> Tj <0004> Tj <0010> Tj <0020> Tj <0021> Tj <0022> Tj ET"
    builder = _Builder()
    # 1 = ToUnicode CMap，2 = Type0 字体，3 = 内容流，4 = 页，5 = 页树，6 = 目录
    builder.add(b"<< /Length %d >>\nstream\n" % len(cmap) + cmap + b"\nendstream")
    builder.add(
        b"<< /Type /Font /Subtype /Type0 /BaseFont /Dummy /Encoding /Identity-H"
        b" /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /DW 1000 >>]"
        b" /ToUnicode 1 0 R >>"
    )
    builder.add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
    builder.add(
        b"<< /Type /Page /Parent 5 0 R /MediaBox [0 0 612 792]"
        b" /Resources << /Font << /F1 2 0 R >> >> /Contents 3 0 R >>"
    )
    builder.add(b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>")
    builder.add(b"<< /Type /Catalog /Pages 5 0 R >>")
    return builder.finish(6)


def test_to_unicode_cmap_maps_two_byte_codes(tmp_path: Path) -> None:
    """``bfchar`` + ``bfrange`` (both spellings) turn CIDs into real text."""
    source = _write(tmp_path, "cjk.pdf", _cjk_page_pdf())
    # 两个 bfchar 字符 + 一个递增 bfrange（a） + 一个数组 bfrange（ABC）
    assert pdf.extract_text(source) == "中文aABC"


def test_glyph_names_are_turned_into_text() -> None:
    """``/Differences`` glyph names, including the ``uniXXXX`` spellings."""
    # 单个字母就是它自己
    assert pdf._glyph_text("a") == "a"
    assert pdf._glyph_text("space") == " "
    assert pdf._glyph_text("endash") == "\u2013"
    # 变体后缀要丢掉
    assert pdf._glyph_text("quoteright.sc") == "\u2019"
    # uniXXXX / uXXXX 两种写法
    assert pdf._glyph_text("uni4E2D") == "中"
    assert pdf._glyph_text("uni4E2D6587") == "中文"
    assert pdf._glyph_text("u4E2D") == "中"
    # 认不出来就什么都别输出（调用方会保留基础编码的字符）
    assert pdf._glyph_text("totally-unknown") == ""


def test_encoding_and_differences_build_the_code_table(tmp_path: Path) -> None:
    """A simple font's ``/Encoding`` + ``/Differences`` decide the characters."""
    document = pdf._Document(_one_page_pdf(b"BT /F1 12 Tf 72 700 Td (x) Tj ET"))
    document.load()
    dictionary = _inline(
        document,
        b"<< /Subtype /Type1 /BaseFont /X"
        b" /Encoding << /BaseEncoding /WinAnsiEncoding"
        b" /Differences [65 /alpha /beta 200 /uni4E2D] >>"
        b" /FirstChar 65 /Widths [500 500 500] >>",
    )
    font = pdf.load_font(document, dictionary)
    # WinAnsi 的基础表 + Differences 覆盖过的三个码位
    assert font.text(b"\x41\x42") == "\u03b1\u03b2"
    assert font.text(b"\xc8") == "中"
    # 没被覆盖的码位仍然按 WinAnsi 解
    assert font.text(b"\x43") == "C"


def _sfnt(widths: Sequence[int], units: int = 1000) -> bytes:
    """Build a minimal TrueType program carrying only head / hhea / hmtx."""
    # head：unitsPerEm 在偏移 18；hhea：numberOfHMetrics 在偏移 34
    head = bytearray(54)
    head[18:20] = units.to_bytes(2, "big")
    hhea = bytearray(36)
    hhea[34:36] = len(widths).to_bytes(2, "big")
    # hmtx：每个字形 4 字节（宽度 + 左轴承）
    hmtx = b"".join(width.to_bytes(2, "big") + b"\x00\x00" for width in widths)
    payloads = [(b"head", bytes(head)), (b"hhea", bytes(hhea)), (b"hmtx", hmtx)]
    # 文件头 12 字节 + 每条表记录 16 字节，表体紧跟其后
    offset = 12 + 16 * len(payloads)
    header = bytearray(12)
    header[0:4] = b"\x00\x01\x00\x00"
    header[4:6] = len(payloads).to_bytes(2, "big")
    records = b""
    body = b""
    for tag, payload in payloads:
        records += tag + b"\x00\x00\x00\x00" + offset.to_bytes(4, "big") + len(payload).to_bytes(4, "big")
        body += payload
        offset += len(payload)
    return bytes(header) + records + body


def test_truetype_widths_are_scaled_to_a_thousand_units() -> None:
    """The embedded program's ``hmtx`` widths come out in 1/1000 em."""
    widths, default = pdf._truetype_widths(_sfnt([500, 1024, 1000], units=2048))
    # 500/2048 em = 244.1 个千分单位
    assert widths[0] == pytest.approx(244.14, abs=0.05)
    assert widths[1] == pytest.approx(500.0, abs=0.05)
    # 最后一条就是 numberOfHMetrics 之后所有字形的宽度
    assert default == pytest.approx(488.28, abs=0.05)
    # 缺表 / 不是字体程序：安静地什么都不给，调用方退回 /DW
    assert pdf._truetype_widths(b"nonsense") == ({}, None)


# --------------------------------------------------------------------------
# 文件层：交叉引用流 / 对象流 / 坏索引 / 加密 / 封面 / 元信息
# --------------------------------------------------------------------------
def _pack_object_stream(objects: Sequence[Tuple[int, bytes]]) -> Tuple[bytes, int]:
    """Pack ``(object number, body)`` pairs the way an ``/ObjStm`` stores them."""
    header = b""
    body = b""
    # 头部是「对象号 相对偏移」；偏移从第一项的起点算，所以先记下 body 的长度
    for number, payload in objects:
        header += b"%d %d " % (number, len(body))
        body += payload + b" "
    return header + body, len(header)


def _xref_stream_pdf() -> bytes:
    """A PDF 1.5 style file: the index is an xref **stream**, objects are packed.

    This is the layout almost every modern writer produces, so the reader has to
    handle it: ``/Root``, ``/Pages`` and the font live inside an ``/ObjStm``
    (type 2 entries) while the page and its content are ordinary objects.
    """
    catalog = b"<< /Type /Catalog /Pages 3 0 R >>"
    pages = b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>"
    font = (
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica"
        b" /Encoding /WinAnsiEncoding /FirstChar 32 /Widths [500] >>"
    )
    packed, first = _pack_object_stream([(2, catalog), (3, pages), (6, font)])
    content = b"BT /F1 12 Tf 72 700 Td (Modern layout) Tj ET"
    page = b"<< /Type /Page /Parent 3 0 R /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>"
    data = bytearray(b"%PDF-1.7\n")
    offsets: Dict[int, int] = {}
    # 1 号：装着 2/3/6 的对象流
    offsets[1] = len(data)
    data += b"1 0 obj\n<< /Type /ObjStm /N 3 /First %d /Length %d >>\nstream\n" % (first, len(packed))
    data += packed + b"\nendstream\nendobj\n"
    # 4 号：页本身；5 号：内容流
    offsets[4] = len(data)
    data += b"4 0 obj\n" + page + b"\nendobj\n"
    offsets[5] = len(data)
    data += b"5 0 obj\n<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream\nendobj\n"
    # 7 号：交叉引用流自己（它的偏移此刻正好是文件末尾）
    offsets[7] = len(data)
    plan = {
        0: (0, 0, 65535),
        1: (1, offsets[1], 0),
        2: (2, 1, 0),
        3: (2, 1, 1),
        4: (1, offsets[4], 0),
        5: (1, offsets[5], 0),
        6: (2, 1, 2),
        7: (1, offsets[7], 0),
    }
    entries = bytearray()
    for number in range(8):
        kind, field1, field2 = plan[number]
        entries += bytes([kind]) + field1.to_bytes(4, "big") + field2.to_bytes(2, "big")
    data += b"7 0 obj\n<< /Type /XRef /Size 8 /W [1 4 2] /Root 2 0 R /Length %d >>\nstream\n" % len(entries)
    data += bytes(entries) + b"\nendstream\nendobj\n"
    # 交叉引用流不用再写 trailer，startxref 直接指到它
    data += b"startxref\n%d\n%%%%EOF\n" % offsets[7]
    return bytes(data)


def test_xref_stream_and_object_stream_are_understood(tmp_path: Path) -> None:
    """A modern file (compressed objects + xref stream) reads like a classic one."""
    source = _write(tmp_path, "modern.pdf", _xref_stream_pdf())
    assert pdf.extract_text(source) == "Modern layout"


def test_a_broken_index_is_recovered_by_scanning(tmp_path: Path) -> None:
    """A truncated file (no xref, no trailer) is still read by scanning it."""
    healthy = _one_page_pdf(b"BT /F1 12 Tf 72 700 Td (Recovered) Tj ET")
    # 掐掉 xref 表与 trailer：只剩对象本身和 %%EOF
    broken = healthy.split(b"xref\n")[0] + b"%%EOF\n"
    source = _write(tmp_path, "broken.pdf", broken)
    assert pdf.extract_text(source) == "Recovered"


def test_an_encrypted_file_is_refused(tmp_path: Path) -> None:
    """``/Encrypt`` means we stay out -- never a brute-force attempt."""
    builder = _Builder()
    builder.add(_simple_font())
    builder.add(b"<< /Length 0 >>\nstream\n\nendstream")
    builder.add(b"<< /Type /Page /Parent 4 0 R /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >>")
    builder.add(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    builder.add(b"<< /Type /Catalog /Pages 4 0 R >>")
    payload = builder.finish(5, extra_trailer=b"/Encrypt 1 0 R ")
    source = _write(tmp_path, "locked.pdf", payload)
    with pytest.raises(pdf.PdfError, match="encrypted"):
        pdf.extract_text(source)


def test_a_file_that_is_not_a_pdf_is_refused(tmp_path: Path) -> None:
    """A ``.pdf`` that is really something else gets a clear error."""
    source = _write(tmp_path, "fake.pdf", b"this is not a pdf at all\n")
    with pytest.raises(pdf.PdfError, match="not a PDF"):
        pdf.extract_text(source)


def _image_only_pdf() -> Tuple[bytes, bytes]:
    """A page that only draws an image -- i.e. what a scanned page looks like."""
    # 一段最小的 JPEG（我们不解码它，只原样搬走）
    image = b"\xff\xd8\xff\xe0scan\xff\xd9"
    content = b"q 100 0 0 100 72 700 cm /Im0 Do Q"
    builder = _Builder()
    builder.add(
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB"
        b" /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % len(image)
        + image + b"\nendstream"
    )
    builder.add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
    builder.add(
        b"<< /Type /Page /Parent 4 0 R /Resources << /XObject << /Im0 1 0 R >> >> /Contents 2 0 R >>"
    )
    builder.add(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    builder.add(b"<< /Type /Catalog /Pages 4 0 R >>")
    return builder.finish(5), image


def test_a_scanned_page_reports_no_text_layer(tmp_path: Path) -> None:
    """A page with images but no text says so instead of importing nothing."""
    payload, _image = _image_only_pdf()
    source = _write(tmp_path, "scanned.pdf", payload)
    with pytest.raises(pdf.PdfError, match="no text layer"):
        pdf.extract_text(source)


def test_the_cover_is_the_first_pages_jpeg(tmp_path: Path) -> None:
    """A ``/DCTDecode`` image on page one comes back untouched as ``image/jpeg``."""
    payload, image = _image_only_pdf()
    source = _write(tmp_path, "cover.pdf", payload)
    assert pdf.extract_cover(source) == (image, "image/jpeg")
    # 没有任何图片的页：老老实实返回 None
    plain = _write(tmp_path, "plain.pdf", _one_page_pdf(b"BT /F1 12 Tf 72 700 Td (x) Tj ET"))
    assert pdf.extract_cover(plain) is None


def test_metadata_reads_the_info_dictionary(tmp_path: Path) -> None:
    """``/Info`` strings are decoded (PDFDocEncoding and UTF-16BE both)."""
    builder = _Builder()
    # 1 号是 /Info：一个普通字符串 + 一个 UTF-16BE（带 BOM）字符串
    info = builder.add(b"<< /Title (Plain Title) /Author <FEFF4F5C8005> >>")
    builder.add(_simple_font())
    builder.add(b"<< /Length 0 >>\nstream\n\nendstream")
    builder.add(b"<< /Type /Page /Parent 5 0 R /Resources << /Font << /F1 2 0 R >> >> /Contents 3 0 R >>")
    builder.add(b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>")
    builder.add(b"<< /Type /Catalog /Pages 5 0 R >>")
    source = _write(tmp_path, "info.pdf", builder.finish(6, info=info))
    rows = pdf.metadata(source)
    assert rows["Title"] == "Plain Title"
    # UTF-16BE 带 BOM 的作者名（"作者"）
    assert rows["Author"] == "作者"
    assert rows["Pages"] == "1"


# --------------------------------------------------------------------------
# 与书库的接口：load_source_text / import_books / 外部工具
# --------------------------------------------------------------------------
def test_pdf_joins_the_supported_extensions() -> None:
    """The library both accepts ``.pdf`` and treats it as an e-book."""
    assert ".pdf" in library.SUPPORTED_EXTENSIONS
    assert ".pdf" in library.EBOOK_EXTENSIONS


def _text_page_pdf(text: bytes = b"Line one") -> bytes:
    """The smallest PDF that carries one line of text."""
    return _one_page_pdf(b"BT /F1 12 Tf 72 700 Td (" + text + b") Tj ET")


def _two_page_pdf() -> bytes:
    """A two page PDF (the same page twice) -- for the page count / progress maths."""
    # 1 字体，2 内容流（两页共用），3/4 两页，5 页树，6 目录
    content = b"BT /F1 12 Tf 72 700 Td (page) Tj ET"
    builder = _Builder()
    builder.add(_simple_font())
    builder.add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
    for _ in range(2):
        builder.add(
            b"<< /Type /Page /Parent 5 0 R /MediaBox [0 0 612 792]"
            b" /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >>"
        )
    builder.add(b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>")
    builder.add(b"<< /Type /Catalog /Pages 5 0 R >>")
    return builder.finish(6)


def test_page_count_walks_the_page_tree_without_reading_text(tmp_path: Path) -> None:
    """``page_count`` is cheap: the page tree is counted, content is not replayed."""
    # 一页与两页各来一份，页数要对得上
    assert pdf.page_count(_write(tmp_path, "one.pdf", _text_page_pdf())) == 1
    assert pdf.page_count(_write(tmp_path, "two.pdf", _two_page_pdf())) == 2
    # 导入时写下的 pages / total_lines 就是它（行号 == 页码）
    source = _write(tmp_path, "两页.pdf", _two_page_pdf())
    _book_id, record = library.import_books(str(source)).imported[0]
    assert record["pages"] == 2 and record["total_lines"] == 2
    # 页数也是进度百分比的分母：2 页的书读到第 2 页就是 100%
    assert library.position_percentage(1, record["total_lines"]) == 100.0


def test_load_source_text_reads_a_pdf(tmp_path: Path) -> None:
    """``load_source_text`` returns the text plus the UTF-8 label."""
    source = _write(tmp_path, "one.pdf", _text_page_pdf())
    text, encoding = library.load_source_text(source)
    assert text.strip() == "Line one"
    assert encoding == "UTF-8"


def test_an_external_pdf_tool_wins_when_it_is_installed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """``pdftotext`` (when present) is preferred over the built-in extractor."""
    source = _write(tmp_path, "one.pdf", _text_page_pdf())

    def fake_tool(_source: Path, destination: Path) -> str:
        # 冒充 pdftotext：把结果写进目标文件
        destination.write_text("from pdftotext\n", encoding="utf-8")
        return "pdftotext"

    monkeypatch.setattr(library, "_run_external_pdf_tool", fake_tool)
    text, _encoding = library.load_source_text(source)
    assert text.strip() == "from pdftotext"


def test_a_scanned_pdf_imports_as_images_and_refuses_conversion(tmp_path: Path) -> None:
    """No text layer is fine for image mode; converting says so instead of guessing."""
    payload, image = _image_only_pdf()
    source = _write(tmp_path, "扫描版.pdf", payload)
    result = library.import_books(str(source))
    # 扫描版也「读」得起来：它就是一堆图
    assert len(result.imported) == 1
    book_id, record = result.imported[0]
    assert record["pages"] == 1
    # 封面照旧落在 PDF 旁边
    assert Path(record["file_path"]).with_suffix(".jpg").read_bytes() == image
    # 转换成文字：明确报「没有文字层」，不落一份空正文
    with pytest.raises(library.LibraryError, match="no text"):
        library.convert_pdf(book_id)
    assert record["text_path"] == ""


def test_importing_a_pdf_keeps_the_file_without_parsing_text(tmp_path: Path) -> None:
    """A PDF imports in **image mode**: the file is kept, no text is parsed."""
    source = _write(tmp_path, "样例书.pdf", _text_page_pdf(b"Hello PDF"))
    result = library.import_books(str(source))
    assert len(result.imported) == 1
    book_id, record = result.imported[0]
    # 收进来的是 PDF 本身（图片模式读的就是它），而不是转出来的 txt
    stored = Path(record["file_path"])
    assert stored.name == "样例书_utf8.pdf"
    assert stored.read_bytes() == source.read_bytes()
    # 记录说明这是图片模式的 pdf：页数 == total_lines，正文还没抽
    assert record["format"] == "pdf"
    assert record["pages"] == 1
    assert record["total_lines"] == 1
    assert record["total_words"] == 0
    assert record["text_path"] == ""
    assert record["encoding"] == library.PDF_IMAGE_ENCODING
    # 目录里连一个 .txt 都没有：导入这一步一个字都没解
    assert not list(stored.parent.glob("*.txt"))
    # 还没有正文的 pdf：文字消费者得到的是一句明确的提示
    with pytest.raises(library.LibraryError, match="not been converted"):
        library.book_text_path(record)
    # 再导入一次：PDF 内容没变 → 同一个 id → 算重复
    again = library.import_books(str(source))
    assert again.duplicates and not again.imported
    assert library.load_library()["books"][book_id]["title"] == "样例书"


def test_convert_pdf_writes_the_text_and_updates_the_record(tmp_path: Path) -> None:
    """「转换成文字」 extracts the layer, keeps the PDF and updates the record."""
    source = _write(tmp_path, "样例书.pdf", _text_page_pdf(b"Hello PDF"))
    book_id, record = library.import_books(str(source)).imported[0]
    converted = library.convert_pdf(book_id)
    # 正文写在 PDF 旁边、同根名
    text_path = Path(converted["text_path"])
    assert text_path.name == "样例书_utf8.txt"
    assert text_path.read_text(encoding="utf-8").splitlines() == ["Hello PDF"]
    # 正文相关的字段换成 txt 的
    assert converted["total_lines"] == 1
    assert converted["total_words"] == 2
    assert converted["chapters"] == []
    assert converted["encoding"] == "UTF-8"
    # PDF 相关的字段一个字没动：图片模式照样能用
    assert converted["format"] == "pdf"
    assert converted["pages"] == 1
    assert Path(converted["file_path"]).suffix == ".pdf"
    # 文字消费者现在拿得到正文了（终端 / serve / toc 都走这一条）
    assert Path(library.book_text_path(converted)).read_text(encoding="utf-8").strip() == "Hello PDF"
    # 再转一次：幂等，不重写也不报错
    again = library.convert_pdf(book_id)
    assert again["text_path"] == converted["text_path"]


def _page_with_cover_and_text() -> Tuple[bytes, bytes]:
    """A page that draws a cover image *and* carries real text."""
    image = b"\xff\xd8\xff\xe0cover\xff\xd9"
    content = b"BT /F1 12 Tf 72 700 Td (With cover) Tj ET q 10 0 0 10 0 0 cm /Im0 Do Q"
    builder = _Builder()
    # 1 图片，2 字体，3 内容，4 页，5 页树，6 目录
    builder.add(
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB"
        b" /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % len(image)
        + image + b"\nendstream"
    )
    builder.add(_simple_font())
    builder.add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
    builder.add(
        b"<< /Type /Page /Parent 5 0 R /Resources << /Font << /F1 2 0 R >>"
        b" /XObject << /Im0 1 0 R >> >> /Contents 3 0 R >>"
    )
    builder.add(b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>")
    builder.add(b"<< /Type /Catalog /Pages 5 0 R >>")
    return builder.finish(6), image


def test_the_cover_lands_next_to_the_pdf(tmp_path: Path) -> None:
    """The cover is written beside the stored PDF -- where the shell looks."""
    payload, image = _page_with_cover_and_text()
    source = _write(tmp_path, "带封面.pdf", payload)
    result = library.import_books(str(source))
    assert len(result.imported) == 1
    stored = Path(result.imported[0][1]["file_path"])
    # 图片模式收的是 PDF：封面就落在它旁边、同名
    assert stored.suffix == ".pdf"
    cover = stored.with_suffix(".jpg")
    assert cover.is_file() and cover.read_bytes() == image


def test_scanning_a_directory_finds_pdfs(tmp_path: Path) -> None:
    """``collect_candidates`` picks PDFs up next to the other formats."""
    _write(tmp_path, "a.pdf", _text_page_pdf())
    (tmp_path / "b.txt").write_text("plain\n", encoding="utf-8")
    # 隐藏文件（macOS 的 ._x.pdf）与不认识的扩展名都不该进来
    _write(tmp_path, "._hidden.pdf", _text_page_pdf())
    _write(tmp_path, "c.docx", b"nope")
    names = [path.name for path in library.collect_candidates(str(tmp_path))]
    assert names == ["a.pdf", "b.txt"]


def test_serve_exposes_image_mode_and_the_conversion(tmp_path: Path) -> None:
    """The RPC layer: rows carry format / pages / text_path, and convert_pdf works."""
    source = _write(tmp_path, "样例书.pdf", _text_page_pdf(b"Hello PDF"))
    library.import_books(str(source))
    rows = serve.handle_request({"id": 1, "method": "list", "params": {}})["result"]["books"]
    # 列表行带上了图片模式要用的三个字段
    assert (rows[0]["format"], rows[0]["pages"], rows[0]["text_path"]) == ("pdf", 1, "")
    # 还没转文字：text 回一条明确的错误，而不是空正文
    failed = serve.handle_request({"id": 2, "method": "text", "params": {"book_id": rows[0]["id"]}})
    assert "not been converted" in failed["error"]["message"]
    # 目录也不该炸：图片模式没有目录，回空列表
    toc_result = serve.handle_request({"id": 3, "method": "toc", "params": {"book_id": rows[0]["id"]}})
    assert toc_result["result"]["entries"] == []
    # 转换成文字：记录与 text 都跟着变
    converted = serve.handle_request(
        {"id": 4, "method": "convert_pdf", "params": {"book_id": rows[0]["id"]}}
    )["result"]
    assert converted["book"]["text_path"].endswith(".txt")
    page = serve.handle_request(
        {"id": 5, "method": "text", "params": {"book_id": rows[0]["id"], "count": 5}}
    )["result"]
    assert page["lines"] == ["Hello PDF"]
    # 转换前后 get_book 都能查：PDF 相关的字段一直在
    book = serve.handle_request(
        {"id": 6, "method": "get_book", "params": {"book_id": rows[0]["id"]}}
    )["result"]["book"]
    assert book["format"] == "pdf" and book["pages"] == 1 and book["text_path"].endswith(".txt")
