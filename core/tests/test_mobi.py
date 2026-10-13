"""Tests for the built-in MOBI / AZW3 extractor (``wreader.mobi``).

The sample files are built here as **synthetic Palm databases**, so the suite
never depends on a real kindle book on the developer's disk.  Every layer gets
its own test: the PalmDOC decompressor, the HUFF/CDIC decompressor (round-tripped
through a tiny identity Huffman table), the container / header parser, cover and
metadata lookup, and the ``library`` integration behind ``def load_source_text``.
"""

# 延迟求值类型注解
from __future__ import annotations

# 拼二进制测试数据用（全部是大端定长字段）
import struct
# 临时路径
from pathlib import Path
# 类型注解
from typing import Sequence, Tuple

# pytest 的 monkeypatch（类型注解）
import pytest

# 被测模块
from wreader import library, mobi


# --------------------------------------------------------------------------
# 造一个最小的 Palm 数据库
# --------------------------------------------------------------------------
def _pdb(records: Sequence[bytes]) -> bytes:
    """Wrap *records* in a minimal Palm database file image."""
    # 索引表 = 78 字节文件头 + 每条 8 字节 + 2 字节对齐空隙
    count = len(records)
    cursor = 78 + 8 * count + 2
    offsets = []
    for record in records:
        offsets.append(cursor)
        cursor += len(record)
    header = bytearray(78)
    # 类型/创建者固定写成 BOOKMOBI，和真实文件一致
    header[60:64] = b"BOOK"
    header[64:68] = b"MOBI"
    struct.pack_into(">H", header, 76, count)
    table = b"".join(struct.pack(">II", offset, i) for i, offset in enumerate(offsets))
    return bytes(header) + table + b"\x00\x00" + b"".join(records)


def _exth(entries: Sequence[Tuple[int, bytes]]) -> bytes:
    """Build an EXTH block from ``(type, payload)`` pairs."""
    # 每条记录 = 4 字节类型 + 4 字节长度（含这 8 字节）+ 载荷
    body = b"".join(
        struct.pack(">II", kind, 8 + len(payload)) + payload
        for kind, payload in entries
    )
    # 12 字节块头（魔数 + 总长 + 条数）
    return b"EXTH" + struct.pack(">II", 12 + len(body), len(entries)) + body


def _record0(
    text_records: int,
    *,
    compression: int = 1,
    version: int = 6,
    first_resource: int = 0xFFFFFFFF,
    exth: bytes = b"",
) -> bytes:
    """Build record 0: the PalmDOC header + MOBI header (+ optional EXTH)."""
    header_length = 232
    record = bytearray(16 + header_length)
    # PalmDOC 头：压缩方式 / 未用 / 正文长度 / 正文记录数 / 记录大小 / 加密 / 未用
    struct.pack_into(">HHIHHHH", record, 0, compression, 0, 0, text_records, 4096, 0, 0)
    # MOBI 头（从偏移 16 开始），字段偏移与真实文件一致
    record[16:20] = b"MOBI"
    struct.pack_into(">I", record, 0x14, header_length)
    struct.pack_into(">I", record, 0x18, 2)  # type = book
    struct.pack_into(">I", record, 0x1C, 65001)  # codepage = UTF-8
    struct.pack_into(">I", record, 0x20, 424242)  # unique id
    struct.pack_into(">I", record, 0x24, version)
    struct.pack_into(">I", record, 0x6C, first_resource)
    struct.pack_into(">I", record, 0x80, 0x40 if exth else 0)  # EXTH 开关位
    return bytes(record) + exth


def _mobi(records: Sequence[bytes]) -> bytes:
    """Shorthand so a test reads as 'this is the file on disk'."""
    return _pdb(records)


def _identity_huff() -> bytes:
    """A HUFF table whose codes just echo the input bytes (a code length of 8)."""
    # 每项 (码长 8, 终止位, maxcode=0xFFFFFFFF) —— 每个字节一个 8 位码
    table1 = struct.pack(">256I", *([0xFF88] * 256))
    table2 = struct.pack(">64I", *([0] * 64))
    return b"HUFF\x00\x00\x00\x18" + struct.pack(">II", 16, 16 + len(table1)) + table1 + table2


def _identity_cdic() -> bytes:
    """A CDIC dictionary pairing code *i* with byte ``255 - i`` (see the table)."""
    offsets = []
    cursor = 16 + 512
    for _ in range(256):
        offsets.append(cursor - 16)
        cursor += 3
    body = struct.pack(">256H", *offsets)
    for i in range(256):
        # 每条短语：2 字节长度（最高位 = 已展开）+ 1 字节内容
        body += struct.pack(">H", 0x8001) + bytes([255 - i])
    return b"CDIC\x00\x00\x00\x10" + struct.pack(">II", 256, 8) + body


# --------------------------------------------------------------------------
# PalmDOC 解压
# --------------------------------------------------------------------------
def test_palmdoc_decodes_literals_and_runs() -> None:
    # 0x01..0x08 = 后面跟一截"照抄"：0x03 后面三个字节就是 abc
    assert mobi._decompress_palmdoc(bytes([0x03, 0x61, 0x62, 0x63])) == b"abc"
    # 单个普通字节（0x00/0x09..0x7F）原样输出
    assert mobi._decompress_palmdoc(bytes([0x00, 0x41, 0x7F])) == b"\x00A\x7f"
    # 0xC0..0xFF = 空格 + (字节 ^ 0x80)
    assert mobi._decompress_palmdoc(bytes([0xC1])) == b" A"


def test_palmdoc_decodes_back_references() -> None:
    # 距离 3、长度 3（distance <= length 那条"逐字节叠"的路）
    assert mobi._decompress_palmdoc(b"abc" + bytes([0x80, 0x18])) == b"abcabc"
    # 距离 5、长度 3（distance > length 那条"一次切片"的路）
    assert mobi._decompress_palmdoc(b"abcdefghij" + bytes([0x80, 0x28])) == b"abcdefghijfgh"


def test_palmdoc_rejects_a_reference_before_the_start() -> None:
    # 距离 0 是非法的（指向自己之前什么都没有）
    with pytest.raises(mobi.MobiError):
        mobi._decompress_palmdoc(bytes([0x80, 0x00]))


# --------------------------------------------------------------------------
# 容器 / 头 / 正文
# --------------------------------------------------------------------------
def test_extract_markup_reads_an_uncompressed_mobi(tmp_path: Path) -> None:
    # 压缩方式 1 = 不压缩，正文记录就是原始标记
    markup = b"<p>Hello</p><mbp:pagebreak/>World"
    target = tmp_path / "book.mobi"
    target.write_bytes(_mobi([_record0(1), markup]))
    text, codec = mobi.extract_markup(target)
    # pagebreak 被换成 <br/>，好让 html_to_text 断行
    assert codec == "utf-8"
    assert "<mbp:pagebreak" not in text
    assert library.html_to_text(text) == "Hello\nWorld"


def test_extract_markup_reads_a_palmdoc_mobi(tmp_path: Path) -> None:
    # "abc" + 距离 3/长度 3 的回指 = "abcabc"
    compressed = b"abc" + bytes([0x80, 0x18])
    target = tmp_path / "book.mobi"
    target.write_bytes(_mobi([_record0(1, compression=2), compressed]))
    text, _codec = mobi.extract_markup(target)
    assert text == "abcabc"


def test_extract_markup_reads_a_huffcdic_mobi(tmp_path: Path) -> None:
    # 用"恒等"HUFF/CDIC 演出压缩路径：压缩流与解压结果一模一样
    payload = b"<p>Huffman</p>"
    record0 = bytearray(_record0(1, compression=0x4448))
    # HUFF 表在记录 2，共 2 条（1 张表 + 1 个词典）
    struct.pack_into(">I", record0, 0x70, 2)
    struct.pack_into(">I", record0, 0x74, 2)
    target = tmp_path / "book.azw3"
    target.write_bytes(_mobi([bytes(record0), payload, _identity_huff(), _identity_cdic()]))
    text, _codec = mobi.extract_markup(target)
    assert text == payload.decode("utf-8")


def test_extract_markup_rejects_a_drm_book(tmp_path: Path) -> None:
    # 加密位置 1（旧 Mobipocket DRM）：明确报错，而不是吐一堆乱码
    header = bytearray(_record0(1))
    header[0x0C:0x0E] = struct.pack(">H", 1)
    target = tmp_path / "locked.mobi"
    target.write_bytes(_mobi([bytes(header), b"<p>x</p>"]))
    with pytest.raises(mobi.MobiError):
        mobi.extract_markup(target)


def test_mobi_header_rejects_a_non_mobi_record() -> None:
    # 记录 0 里没有 MOBI 魔数：不是 MOBI 文件
    with pytest.raises(mobi.MobiError):
        mobi._MobiHeader(b"\x00" * 40)



# --------------------------------------------------------------------------
# 封面与元信息
# --------------------------------------------------------------------------
def test_extract_cover_follows_the_exth_cover_offset(tmp_path: Path) -> None:
    # 第一条资源记录是记录 2；EXTH 201 说封面是"资源里的第 0 条"
    image = b"\xff\xd8\xff" + b"fake-jpeg-body"
    record0 = _record0(1, first_resource=2, exth=_exth([(201, struct.pack(">I", 0))]))
    target = tmp_path / "book.mobi"
    target.write_bytes(_mobi([record0, b"<p>x</p>", image]))
    found = mobi.extract_cover(target)
    assert found is not None
    payload, media_type = found
    assert media_type == "image/jpeg"
    assert payload == image


def test_extract_cover_is_none_without_an_exth_cover(tmp_path: Path) -> None:
    target = tmp_path / "book.mobi"
    target.write_bytes(_mobi([_record0(1, first_resource=2), b"<p>x</p>", b"not an image"]))
    assert mobi.extract_cover(target) is None


def test_extract_cover_guesses_png_and_webp() -> None:
    assert mobi._sniff_image(b"\x89PNG\r\n\x1a\n" + b"x") == "image/png"
    assert mobi._sniff_image(b"GIF89a" + b"x") == "image/gif"
    assert mobi._sniff_image(b"RIFF\x00\x00\x00\x00WEBP") == "image/webp"
    assert mobi._sniff_image(b"plain text") is None


def test_metadata_comes_from_the_exth_block(tmp_path: Path) -> None:
    exth = _exth([(503, "三体".encode("utf-8")), (100, "刘慈欣".encode("utf-8"))])
    target = tmp_path / "book.mobi"
    target.write_bytes(_mobi([_record0(1, exth=exth), b"<p>x</p>"]))
    assert mobi.metadata(target) == {"title": "三体", "author": "刘慈欣"}


def test_extract_mobi_cover_writes_next_to_the_text(tmp_path: Path) -> None:
    # 落盘位置与 epub 那条路一致：正文同名、只换扩展名
    image = b"\x89PNG\r\n\x1a\n" + b"bytes"
    record0 = _record0(1, first_resource=2, exth=_exth([(201, struct.pack(">I", 0))]))
    source = tmp_path / "book.mobi"
    source.write_bytes(_mobi([record0, b"<p>x</p>", image]))
    converted = tmp_path / "book_utf8.txt"
    written = library.extract_mobi_cover(source, converted)
    assert written is not None
    assert written == converted.with_suffix(".png")
    assert written.read_bytes() == image


# --------------------------------------------------------------------------
# library 集成
# --------------------------------------------------------------------------
def test_load_source_text_reads_a_mobi(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # 机器上没有 calibre：确保走内置提取器
    monkeypatch.setattr(library, "_run_external_mobi_tool", lambda *a: None)
    target = tmp_path / "book.mobi"
    target.write_bytes(_mobi([_record0(1), b"<p>Chapter One</p><p>Body</p>"]))
    text, encoding = library.load_source_text(target)
    assert text == "Chapter One\nBody"
    assert encoding == "UTF-8"


def test_import_books_indexes_an_azw3(tmp_path: Path, home, monkeypatch: pytest.MonkeyPatch) -> None:
    # 一本合成 azw3：导入后应进书库、正文落到 novels 目录
    monkeypatch.setattr(library, "_run_external_mobi_tool", lambda *a: None)
    payload = b"<p>Chapter One</p><p>Body</p>"
    record0 = bytearray(_record0(1, compression=0x4448))
    struct.pack_into(">I", record0, 0x70, 2)
    struct.pack_into(">I", record0, 0x74, 2)
    source = tmp_path / "三体.azw3"
    source.write_bytes(_mobi([bytes(record0), payload, _identity_huff(), _identity_cdic()]))

    result = library.import_books(str(source))
    assert len(result.imported) == 1
    _book_id, record = result.imported[0]
    assert record["title"] == "三体"
    converted = Path(record["file_path"])
    assert converted.exists()
    assert "Chapter One" in converted.read_text(encoding="utf-8")
    # 再导一次：内容一样，算重复
    again = library.import_books(str(source))
    assert again.imported == []
    assert len(again.duplicates) == 1

