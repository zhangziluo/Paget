"""PDF text and cover extraction -- standard library only.

A PDF is **not** a text format: it is a pile of objects (dictionaries, arrays,
streams) plus a page tree, and the text only exists as drawing instructions
(``BT`` / ``Tf`` / ``Tj`` ...) inside each page's content stream.  Getting
readable text out of it therefore means four things, all done here:

1. find the objects -- the cross reference table, a cross reference *stream*, or
   the compressed object streams (``/ObjStm``) modern writers use;
2. inflate the streams -- ``FlateDecode`` and the smaller filters, predictors
   included;
3. walk the page tree (``/Root`` → ``/Pages`` → ``/Kids``) and replay every
   page's text operators;
4. map the character codes back to Unicode through that page's fonts --
   ``/ToUnicode`` CMaps when the file has them, the simple-font encodings
   otherwise.

This is best-effort and **third-party-library free**, the same rule
:mod:`wreader.mobi` follows: an external converter (``pdftotext``) is used when
it happens to be installed, but the built-in path has to really work.

What it deliberately does *not* do:

* **images / OCR** -- a scanned PDF has no text layer; the caller gets a plain
  :class:`PdfError` saying so instead of a pile of nonsense;
* **encryption** -- an encrypted document is refused, never brute-forced;
* **exotic text tricks** -- Type 3 fonts and vertical writing (``/WMode 1``) are
  ignored, so a page using them comes out thinner than it looks on screen.

Only three things are public: :func:`extract_text`, :func:`extract_cover` and
:func:`metadata`.  Title, author and chapters are decided in ``library`` for
every format the same way (from the file name), exactly like epub and mobi.
"""

# 延迟求值类型注解
from __future__ import annotations

# zlib 解开 FlateDecode 的流（PDF 里最常见的那种压缩）
import zlib
# 兜底扫描 `N G obj` 与 `/Type /Catalog` 时用的正则
import re
# 编 PNG（封面图）时写大端整数字段
import struct
# 路径处理
from pathlib import Path
# 类型注解
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple


# PDF 读不出来时统一抛这个异常（library 那边会转成自己的 LibraryError）
class PdfError(Exception):
    """Raised when a PDF file cannot be understood or carries no text layer."""


# PDF 的空白字符（规范 7.2.3）：NUL、TAB、LF、FF、CR、空格
_WHITESPACE = b"\x00\t\n\x0c\r "
# 定界符：这些字符本身就结束一个名字或关键字
_DELIMITERS = b"()<>[]{}/%"
# 十六进制字符表，解 <...> 形式的字符串用
_HEX_DIGITS = b"0123456789abcdefABCDEF"
# 字面量字符串里的单字符转义（规范 7.3.4.2）；八进制与「反斜杠 + 换行」单独处理
_ESCAPES: Dict[int, int] = {
    0x6E: 0x0A,      # \n
    0x72: 0x0D,      # \r
    0x74: 0x09,      # \t
    0x62: 0x08,      # \b
    0x66: 0x0C,      # \f
    0x28: 0x28,      # \( —— 圆括号自己
    0x29: 0x29,      # \)
    0x5C: 0x5C,      # \\ —— 反斜杠自己
}


class _Name(str):
    """A PDF name object (``/Type``).  A ``str`` subclass, so dictionary keys
    written by hand (``font.get("Subtype")``) match the parsed ones."""


class _Keyword(str):
    """A bare keyword in the syntax: an operator (``Tj``), ``obj``, ``stream``...
    ``true`` / ``false`` / ``null`` never reach here -- they become Python values."""


class _Ref:
    """An indirect reference: ``12 0 R``."""

    __slots__ = ("number", "generation")

    def __init__(self, number: int, generation: int = 0) -> None:
        # 对象号
        self.number = number
        # 生成号（现代文件里几乎总是 0）
        self.generation = generation

    def __repr__(self) -> str:  # pragma: no cover - 只为报错时看得懂
        return "{} {} R".format(self.number, self.generation)


class _Stream:
    """A stream object: its dictionary plus the **raw** (still encoded) bytes."""

    __slots__ = ("dictionary", "raw")

    def __init__(self, dictionary: Dict[Any, Any], raw: bytes) -> None:
        # 流字典，/Filter、/Length、/Subtype 都在里面
        self.dictionary = dictionary
        # 还没解码的原始字节（要不要解、怎么解由调用方决定）
        self.raw = raw


class _Parser:
    """A tokenizer for the PDF object syntax.

    The same class reads a whole file (``1 0 obj ... endobj``), a cross reference
    stream and a page's content stream -- they are all the same mini-language.
    """

    __slots__ = ("data", "pos")

    def __init__(self, data: bytes) -> None:
        # 被解析的字节串
        self.data = data
        # 当前读到哪儿
        self.pos = 0

    def at_end(self) -> bool:
        """True when nothing but whitespace is left."""
        # 先跳过空白与注释，再看还有没有东西
        self.skip_space()
        return self.pos >= len(self.data)

    def skip_space(self) -> None:
        """Skip whitespace and ``%`` comments."""
        data = self.data
        length = len(data)
        while self.pos < length:
            char = data[self.pos]
            # 普通空白：继续往后走
            if char in _WHITESPACE:
                self.pos += 1
                continue
            # '%' 起一行注释，一直吃到行尾
            if char == 0x25:
                end = data.find(b"\n", self.pos)
                self.pos = length if end == -1 else end + 1
                continue
            # 别的字符说明空白到头了
            break

    def read_token(self) -> bytes:
        """Read one bare token: up to whitespace or a delimiter."""
        data = self.data
        start = self.pos
        length = len(data)
        while self.pos < length:
            char = data[self.pos]
            # 空白或定界符都算结束（定界符本身不消耗：调用方还要看它）
            if char in _WHITESPACE or char in _DELIMITERS:
                break
            self.pos += 1
        return data[start:self.pos]

    def parse_object(self) -> Any:
        """Parse one object: null / bool / number / name / string / array /
        dictionary / reference / keyword."""
        # 先把空白与注释跳掉
        self.skip_space()
        if self.pos >= len(self.data):
            raise PdfError("unexpected end of data")
        char = self.data[self.pos]
        # '/' 开头是名字
        if char == 0x2F:
            return self.parse_name()
        # '(' 开头是字面量字符串
        if char == 0x28:
            return self.parse_literal_string()
        # '<' 开头：两个 '<' 是字典，一个 '<' 是十六进制字符串
        if char == 0x3C:
            if self.data[self.pos + 1:self.pos + 2] == b"<":
                return self.parse_dictionary()
            return self.parse_hex_string()
        # '[' 开头是数组
        if char == 0x5B:
            return self.parse_array()
        # 数字（含正负号与小数点）
        if char in b"0123456789+-.":
            return self.parse_number_or_reference()
        # 剩下的都是关键字（true/false/null/操作符/obj 之类）
        return self.parse_keyword()

    def parse_keyword(self) -> Any:
        """Read a keyword; ``true`` / ``false`` / ``null`` become Python values."""
        token = self.read_token()
        # 空 token 说明这里根本不是合法的对象起点
        if not token:
            raise PdfError("unexpected character at offset {}".format(self.pos))
        if token == b"true":
            return True
        if token == b"false":
            return False
        if token == b"null":
            return None
        return _Keyword(token.decode("latin-1"))

    def parse_name(self) -> _Name:
        """Read a name: ``/Name`` with ``#XX`` escapes."""
        # 跳过开头的 '/'
        self.pos += 1
        raw = self.read_token()
        # #20 这类转义要还原成真实字符
        out = bytearray()
        index = 0
        while index < len(raw):
            pair = raw[index + 1:index + 3]
            # 形状对（'#' + 两个十六进制位）就还原，否则原样收下
            if raw[index] == 0x23 and len(pair) == 2 and pair[0] in _HEX_DIGITS and pair[1] in _HEX_DIGITS:
                out.append(int(pair.decode("ascii"), 16))
                index += 3
                continue
            out.append(raw[index])
            index += 1
        # 名字用 latin-1 解码：它本来就是字节串
        return _Name(out.decode("latin-1"))

    def parse_literal_string(self) -> bytes:
        """Read a ``(...)`` string, undoing escapes and nested parentheses."""
        # 跳过开头的 '('
        self.pos += 1
        data = self.data
        out = bytearray()
        # 圆括号可以嵌套：depth 回到 0 才是字符串结束
        depth = 1
        while self.pos < len(data):
            char = data[self.pos]
            self.pos += 1
            # 反斜杠转义
            if char == 0x5C:
                if self.pos >= len(data):
                    break
                escape = data[self.pos]
                self.pos += 1
                # 行尾续行：反斜杠 + 真的换行符，什么都不输出（LF / CR / CRLF 都算）
                if escape in (0x0A, 0x0D):
                    if escape == 0x0D and data[self.pos:self.pos + 1] == b"\n":
                        self.pos += 1
                # 单字符转义（\n \r \t \b \f \( \) \\）
                elif escape in _ESCAPES:
                    out.append(_ESCAPES[escape])
                # \ddd 八进制（最多三位）
                elif 0x30 <= escape <= 0x37:
                    digits = bytes([escape])
                    while len(digits) < 3 and self.pos < len(data) and 0x30 <= data[self.pos] <= 0x37:
                        digits += data[self.pos:self.pos + 1]
                        self.pos += 1
                    out.append(int(digits, 8) & 0xFF)
                # 别的转义按规范就是那个字符本身
                else:
                    out.append(escape)
                continue
            # '(' 进入更深一层
            if char == 0x28:
                depth += 1
                out.append(char)
                continue
            # ')' 退出一层，退到 0 就结束
            if char == 0x29:
                depth -= 1
                if depth == 0:
                    break
                out.append(char)
                continue
            out.append(char)
        return bytes(out)

    def parse_hex_string(self) -> bytes:
        """Read a ``<48656C6C6F>`` string (whitespace inside is ignored)."""
        # 跳过开头的 '<'
        self.pos += 1
        end = self.data.find(b">", self.pos)
        # 没有收尾的 '>'：吃到文件末尾（坏文件也要能读一半）
        if end == -1:
            end = len(self.data)
        raw = bytes(char for char in self.data[self.pos:end] if char in _HEX_DIGITS)
        self.pos = end + 1 if end < len(self.data) else end
        # 奇数个十六进制位按规范末尾补 0
        if len(raw) % 2:
            raw += b"0"
        try:
            return bytes.fromhex(raw.decode("ascii"))
        except ValueError as exc:  # pragma: no cover - 上面的过滤已经挡掉了
            raise PdfError("broken hex string") from exc

    def parse_array(self) -> List[Any]:
        """Read ``[ ... ]``; array elements may be any object."""
        # 跳过开头的 '['
        self.pos += 1
        items: List[Any] = []
        while True:
            self.skip_space()
            if self.pos >= len(self.data):
                raise PdfError("array is not closed")
            # ']' 收尾
            if self.data[self.pos] == 0x5D:
                self.pos += 1
                return items
            items.append(self.parse_object())

    def parse_dictionary(self) -> Dict[Any, Any]:
        """Read ``<< /Key value ... >>``."""
        # 跳过开头的 '<<'
        self.pos += 2
        result: Dict[Any, Any] = {}
        while True:
            self.skip_space()
            if self.pos >= len(self.data):
                raise PdfError("dictionary is not closed")
            # '>>' 收尾
            if self.data[self.pos:self.pos + 2] == b">>":
                self.pos += 2
                return result
            key = self.parse_object()
            # 规范里键必须是名字；坏文件里出现别的类型时也不至于丢掉整本
            if not isinstance(key, _Name):
                key = _Name(str(key))
            result[key] = self.parse_object()

    def parse_number_or_reference(self) -> Any:
        """Read a number, or the ``N G R`` reference it may be the start of."""
        token = self.read_token()
        text = token.decode("latin-1")
        # 带小数点 / 指数的都是实数
        if "." in text:
            try:
                return float(text)
            except ValueError as exc:
                raise PdfError("bad number: {!r}".format(text)) from exc
        try:
            number = int(text)
        except ValueError as exc:
            raise PdfError("bad number: {!r}".format(text)) from exc
        # 整数之后可能是「对象号 生成号 R」
        saved = self.pos
        self.skip_space()
        # 只在这一处向前看：先看一个整数
        if self.data[self.pos:self.pos + 1].isdigit():
            generation = self.read_token()
            if generation.isdigit():
                self.skip_space()
                keyword = self.read_token()
                # 三个都在：这才是引用
                if keyword == b"R":
                    return _Ref(number, int(generation))
        # 不是引用就把位置退回去，按普通整数返回
        self.pos = saved
        return number


# --------------------------------------------------------------------- 过滤器
# 每条过滤器都收「已解码的字节 + 该层的 /DecodeParms」，返回解码后的字节
_FilterFn = Callable[[bytes, Dict[Any, Any]], bytes]


def _flate_decode(data: bytes, params: Dict[Any, Any]) -> bytes:
    """``FlateDecode`` -- zlib, with a raw-deflate retry for sloppy writers."""
    # 正常情况：带 zlib 头的 deflate
    for wbits in (15, -15):
        try:
            # 用 decompressobj 而不是 decompress：截断的流也能救回前半段
            return zlib.decompressobj(wbits).decompress(data)
        except zlib.error:
            continue
    raise PdfError("broken FlateDecode stream")


def _ascii_hex_decode(data: bytes, params: Dict[Any, Any]) -> bytes:
    """``ASCIIHexDecode``: hex digits, whitespace ignored, ``>`` ends it."""
    # 只留下十六进制位
    raw = bytes(char for char in data if char in _HEX_DIGITS)
    # 奇数个位按规范补 0
    if len(raw) % 2:
        raw += b"0"
    return bytes.fromhex(raw.decode("ascii"))


def _ascii85_decode(data: bytes, params: Dict[Any, Any]) -> bytes:
    """``ASCII85Decode``: five base-85 digits per four bytes, ``z`` = zeros."""
    out = bytearray()
    group: List[int] = []
    # 标准封装会写 '<~ ... ~>'；PDF 里通常省略，但两边都要认
    if data.startswith(b"<~"):
        data = data[2:]
    for byte in data:
        # 空白随便填
        if byte in _WHITESPACE:
            continue
        # '~>'（或光秃秃的 '>'）是收尾标记，后面不看
        if byte in (0x7E, 0x3E):
            break
        # 'z' 是「四个零字节」的缩写（只允许出现在一组开头）
        if byte == 0x7A and not group:
            out += b"\x00\x00\x00\x00"
            continue
        # '!'..'u' 才是有效数字
        if not 0x21 <= byte <= 0x75:
            continue
        group.append(byte - 0x21)
        if len(group) == 5:
            value = 0
            for digit in group:
                value = value * 85 + digit
            out += value.to_bytes(4, "big")
            group = []
    # 最后一组不足五位：补 'u' 再解，只取前面几位有效字节
    if group:
        missing = 5 - len(group)
        value = 0
        for digit in group + [84] * missing:
            value = value * 85 + digit
        out += value.to_bytes(4, "big")[:4 - missing]
    return bytes(out)


def _run_length_decode(data: bytes, params: Dict[Any, Any]) -> bytes:
    """``RunLengthDecode``: 1 length byte + literal or repeated run."""
    out = bytearray()
    index = 0
    while index < len(data):
        length = data[index]
        index += 1
        # 128 是结束标记
        if length == 128:
            break
        # < 128：后面 length+1 个字节是原文
        if length < 128:
            out += data[index:index + length + 1]
            index += length + 1
            continue
        # > 128：后面 1 个字节重复 257-length 次
        if index < len(data):
            out += bytes([data[index]]) * (257 - length)
            index += 1
    return bytes(out)


def _lzw_decode(data: bytes, params: Dict[Any, Any]) -> bytes:
    """``LZWDecode``: the PDF flavour -- 9..12 bit codes, 256 clears, 257 ends."""
    # EarlyChange 默认 1：码宽比常见实现早一步增长
    early = int(params.get("EarlyChange", 1) or 0)
    out = bytearray()
    table: List[bytes] = [bytes([value]) for value in range(256)] + [b"", b""]
    width = 9
    buffer = 0
    bits = 0
    previous: Optional[bytes] = None
    for byte in data:
        buffer = (buffer << 8) | byte
        bits += 8
        while bits >= width:
            bits -= width
            code = (buffer >> bits) & ((1 << width) - 1)
            # 256 清表，257 结束
            if code == 256:
                table = [bytes([value]) for value in range(256)] + [b"", b""]
                width = 9
                previous = None
                continue
            if code == 257:
                return bytes(out)
            # 正常的一项（码可能在表里，也可能是「上一项 + 它自己的首字节」）
            if previous is None:
                entry = table[code]
            elif code < len(table):
                entry = table[code]
                table.append(previous + entry[:1])
            else:
                entry = previous + previous[:1]
                table.append(entry)
            out += entry
            previous = entry
            # 表满了就把码宽加一位（最多 12 位）
            if width < 12 and len(table) + (1 if early else 0) >= (1 << width):
                width += 1
    return bytes(out)


def _paeth(left: int, up: int, upleft: int) -> int:
    """The PNG Paeth predictor."""
    # 三个邻居里挑最接近的
    estimate = left + up - upleft
    dl = abs(estimate - left)
    du = abs(estimate - up)
    dul = abs(estimate - upleft)
    if dl <= du and dl <= dul:
        return left
    if du <= dul:
        return up
    return upleft


def _apply_predictor(data: bytes, params: Dict[Any, Any]) -> bytes:
    """Undo a stream's ``/Predictor`` (PNG 10..15 or TIFF 2) if it declared one.

    Text streams never need this; image streams (and the odd content stream) do.
    Only 8 bits per component is handled -- that covers what PDF writers actually
    produce for the filters a reader has to inflate.
    """
    # 没有 Predictor（或 1 = 不预测）就原样返回
    predictor = int(params.get("Predictor", 1) or 1)
    if predictor <= 1:
        return data
    # 每个像素几个分量 / 每行几列
    colors = int(params.get("Colors", 1) or 1)
    bits = int(params.get("BitsPerComponent", 8) or 8)
    columns = int(params.get("Columns", 1) or 1)
    # 只处理 8 位：别的位宽在这个场景里几乎见不到，硬解只会解错
    if bits != 8:
        return data
    # 8 位时一行就是 colors × columns 个字节
    row_length = max(1, colors * columns)
    out = bytearray()
    # TIFF Predictor 2：逐行做「左邻相加」，没有行首标记
    if predictor == 2:
        for start in range(0, len(data), row_length):
            row = bytearray(data[start:start + row_length])
            for index in range(colors, len(row)):
                row[index] = (row[index] + row[index - colors]) & 0xFF
            out += row
        return bytes(out)
    # PNG 预测：每行前面多一个「过滤类型」字节
    previous = bytearray(row_length)
    position = 0
    while position + row_length < len(data) + 1:
        kind = data[position]
        position += 1
        row = bytearray(data[position:position + row_length])
        position += row_length
        # 行尾可能被截断：不够一行就按剩下的算
        if not row:
            break
        if kind == 1:
            for index in range(colors, len(row)):
                row[index] = (row[index] + row[index - colors]) & 0xFF
        elif kind == 2:
            for index in range(len(row)):
                row[index] = (row[index] + previous[index]) & 0xFF
        elif kind == 3:
            for index in range(len(row)):
                left = row[index - colors] if index >= colors else 0
                row[index] = (row[index] + ((left + previous[index]) >> 1)) & 0xFF
        elif kind == 4:
            for index in range(len(row)):
                left = row[index - colors] if index >= colors else 0
                up = previous[index]
                upleft = previous[index - colors] if index >= colors else 0
                row[index] = (row[index] + _paeth(left, up, upleft)) & 0xFF
        # kind == 0：这一行没预测，原样
        out += row
        previous = row
    return bytes(out)


# 过滤器名（含 PDF 2 里的短别名）→ 实现
_FILTERS: Dict[str, _FilterFn] = {
    "FlateDecode": _flate_decode,
    "Fl": _flate_decode,
    "ASCIIHexDecode": _ascii_hex_decode,
    "AHx": _ascii_hex_decode,
    "ASCII85Decode": _ascii85_decode,
    "A85": _ascii85_decode,
    "RunLengthDecode": _run_length_decode,
    "RL": _run_length_decode,
    "LZWDecode": _lzw_decode,
    "LZW": _lzw_decode,
}


def decode_stream(stream: _Stream, resolve: Callable[[Any], Any]) -> bytes:
    """Decode *stream* by applying its ``/Filter`` chain (with predictors).

    *resolve* turns indirect references into real objects -- ``/Filter``,
    ``/DecodeParms`` and ``/Length`` are allowed to be references, and in modern
    files they often are.
    """
    # 起点是流里的原始字节
    data = stream.raw
    # /Filter 可以是一个名字，也可以是一串名字
    filters = resolve(stream.dictionary.get("Filter"))
    # 没有过滤器：字节本身就是内容
    if filters is None:
        return data
    if isinstance(filters, str):
        filters = [filters]
    if not isinstance(filters, list):
        return data
    # /DecodeParms 与过滤器一一对应（也可能只写一个字典）
    raw_params = resolve(stream.dictionary.get("DecodeParms") or stream.dictionary.get("DP"))
    if isinstance(raw_params, list):
        params_list = raw_params
    else:
        params_list = [raw_params] if raw_params is not None else []
    # 依次过每一个过滤器
    for index, name in enumerate(filters):
        # 过滤器名必须是名字对象（字符串）
        if not isinstance(name, str):
            raise PdfError("bad /Filter entry: {!r}".format(name))
        handler = _FILTERS.get(str(name))
        # 不认识的过滤器：说清是哪一个，别静默丢内容
        if handler is None:
            raise PdfError("unsupported stream filter: {}".format(name))
        # 这一层的参数（可能没有）
        params = params_list[index] if index < len(params_list) else None
        params = resolve(params) if params is not None else None
        data = handler(data, params if isinstance(params, dict) else {})
        # 解完这一层，按需要还原预测
        data = _apply_predictor(data, params if isinstance(params, dict) else {})
    return data


# 对象头：`12 0 obj`（负向断言免得把 `112 0 obj` 拆成 `12 0 obj`）
_OBJECT_HEADER = re.compile(rb"(?<![0-9])(\d+)[ \t\r\n]+(\d+)[ \t\r\n]+obj\b")


class _Document:
    """One PDF file: its objects, its trailer and (via ``pages``) its page tree.

    Objects are addressed the way the file addresses them (object number) and are
    parsed lazily, so an 800 page book only pays for what is actually read.  All
    three ways of storing the index are understood: the classic ``xref`` table, a
    cross reference **stream** (PDF 1.5+) and the compressed object streams those
    files keep most of their dictionaries in.
    """

    def __init__(self, data: bytes) -> None:
        # 整个文件的字节
        self.data = data
        # 对象号 → 文件里的偏移（传统 xref 与兜底扫描都写这里）
        self.offsets: Dict[int, int] = {}
        # 对象号 → (装在哪个对象流里, 流内第几项)
        self.compressed: Dict[int, Tuple[int, int]] = {}
        # 对象号 → 解析好的对象（同一个对象只解析一次）
        self.cache: Dict[int, Any] = {}
        # trailer 字典：/Root、/Info、/Encrypt 在这里
        self.trailer: Dict[Any, Any] = {}
        # 正在解析的对象号：循环引用时靠它兜住
        self.loading: Set[int] = set()

    # -------------------------------------------------------------- 入口
    def load(self) -> None:
        """Read the cross reference data, falling back to a scan of the file."""
        # 从文件尾部的 startxref 开始读
        start = self._startxref()
        if start is not None:
            try:
                self._read_xref(start, set())
            except PdfError:
                # xref 坏了（截断、被改写过）：全部丢掉，交给扫描
                self.offsets.clear()
                self.compressed.clear()
                self.cache.clear()
                self.trailer = {}
        # 读不出 /Root 说明这份索引不可用：整文件扫一遍对象头
        if not isinstance(self.trailer.get("Root"), _Ref):
            self.offsets.clear()
            self.compressed.clear()
            self.cache.clear()
            self.trailer = {}
            self._scan_objects()
        # 加密的文件不碰（规范允许 RC4/AES，没有解密的打算）
        if self.trailer.get("Encrypt") is not None:
            raise PdfError("this PDF is encrypted")

    def _startxref(self) -> Optional[int]:
        """The byte offset the file's last ``startxref`` points at."""
        # 从尾部往前找最后一个 startxref（正常文件里它就在 EOF 之前）
        index = self.data.rfind(b"startxref")
        if index == -1:
            return None
        # 关键字后面那个整数就是偏移
        fields = self.data[index + 9:index + 40].split()
        if not fields or not fields[0].isdigit():
            return None
        return int(fields[0])

    def _read_xref(self, offset: int, seen: Set[int]) -> None:
        """Read one cross reference section, then follow ``/Prev`` (and
        ``/XRefStm``) through the older sections."""
        # 同一段不读第二次（坏文件里 /Prev 可能指回自己）
        if offset in seen or offset < 0 or offset >= len(self.data):
            return
        seen.add(offset)
        # 传统表格以 'xref' 开头，别的都是交叉引用流
        if self.data[offset:offset + 4] == b"xref":
            trailer = self._read_xref_table(offset)
        else:
            trailer = self._read_xref_stream(offset)
        # 合并 trailer：新的优先（先读到的就是新的，所以用 setdefault）
        for key, value in trailer.items():
            self.trailer.setdefault(key, value)
        # 混合文件：/XRefStm 指的是同一代的补充表格
        extra = trailer.get("XRefStm")
        if isinstance(extra, int):
            self._read_xref(extra, seen)
        # 更老的索引段接着读
        previous = trailer.get("Prev")
        if isinstance(previous, int):
            self._read_xref(previous, seen)

    def _read_xref_table(self, offset: int) -> Dict[Any, Any]:
        """Read a classic ``xref`` table; returns its trailer dictionary."""
        parser = _Parser(self.data)
        # 跳过开头的 'xref' 关键字
        parser.pos = offset + 4
        while True:
            parser.skip_space()
            # 表格结束的标志就是 trailer 关键字
            if parser.data[parser.pos:parser.pos + 7] == b"trailer":
                parser.pos += 7
                trailer = parser.parse_object()
                return trailer if isinstance(trailer, dict) else {}
            # 一小节的开头：起始对象号 + 条数
            first_token = parser.read_token()
            parser.skip_space()
            count_token = parser.read_token()
            if not first_token.isdigit() or not count_token.isdigit():
                raise PdfError("broken xref table at offset {}".format(offset))
            first = int(first_token)
            total = int(count_token)
            # 每条 20 字节：偏移、生成号、'n'（在用）或 'f'（空闲）
            for index in range(total):
                parser.skip_space()
                entry_offset = parser.read_token()
                parser.skip_space()
                parser.read_token()
                parser.skip_space()
                kind = parser.read_token()
                number = first + index
                # 只收「在用」的条目；老段落不覆盖新段落
                if kind == b"n" and entry_offset.isdigit() and number not in self.offsets:
                    self.offsets[number] = int(entry_offset)

    def _read_xref_stream(self, offset: int) -> Dict[Any, Any]:
        """Read a cross reference **stream** (PDF 1.5+) and index its entries."""
        value = self._parse_object_at(offset)
        if not isinstance(value, _Stream):
            raise PdfError("no cross reference at offset {}".format(offset))
        dictionary = value.dictionary
        # /W 是每一列的字节数（类型、字段 2、字段 3）
        widths = self.resolve(dictionary.get("W"))
        if not isinstance(widths, list) or len(widths) < 3:
            raise PdfError("cross reference stream has no /W")
        sizes = [int(width or 0) for width in widths[:3]]
        # /Index 成对给出「起始对象号 / 条数」；缺省就是 0 .. /Size
        index = self.resolve(dictionary.get("Index"))
        ranges: List[int] = []
        if isinstance(index, list) and index and len(index) % 2 == 0:
            ranges = [int(item) for item in index]
        else:
            ranges = [0, int(self.resolve(dictionary.get("Size", 0)) or 0)]
        data = decode_stream(value, self.resolve)
        position = 0
        width = sum(sizes)
        # 一段一段、一条一条地读
        for pair in range(0, len(ranges), 2):
            first = ranges[pair]
            total = ranges[pair + 1]
            for number in range(first, first + total):
                if width == 0 or position + width > len(data):
                    return dictionary
                fields: List[int] = []
                for size in sizes:
                    fields.append(int.from_bytes(data[position:position + size], "big") if size else 0)
                    position += size
                # 类型 0 = 空闲；1 = 文件里的偏移；2 = 装在对象流里
                if fields[0] == 1 and number not in self.offsets:
                    self.offsets[number] = fields[1]
                elif fields[0] == 2 and number not in self.compressed:
                    self.compressed[number] = (fields[1], fields[2])
        return dictionary

    # -------------------------------------------------------------- 对象
    def _parse_object_at(self, offset: int) -> Any:
        """Parse the object that starts at *offset* (``N G obj ... endobj``)."""
        parser = _Parser(self.data)
        parser.pos = offset
        parser.read_token()
        parser.skip_space()
        parser.read_token()
        parser.skip_space()
        keyword = parser.read_token()
        # 头部不是 obj：这个偏移根本不是对象起点
        if keyword != b"obj":
            raise PdfError("no object at offset {}".format(offset))
        value = parser.parse_object()
        # 字典后面紧跟着 stream 的，就是流对象
        parser.skip_space()
        if isinstance(value, dict) and parser.data[parser.pos:parser.pos + 6] == b"stream":
            return self._read_stream_body(parser, value)
        return value

    def _read_stream_body(self, parser: _Parser, dictionary: Dict[Any, Any]) -> _Stream:
        """Capture the bytes between ``stream`` and ``endstream``."""
        # 'stream' 之后按规范要么 CRLF 要么 LF（坏文件里的单个 CR 也认）
        position = parser.pos + 6
        if self.data[position:position + 2] == b"\r\n":
            position += 2
        elif self.data[position:position + 1] in (b"\n", b"\r"):
            position += 1
        # /Length 通常是整数（也可能是引用）
        length = self.resolve(dictionary.get("Length"))
        raw: Optional[bytes] = None
        if isinstance(length, int) and 0 <= length <= len(self.data) - position:
            candidate = self.data[position:position + length]
            # 长度对得上（不远处就是 endstream）才信它
            tail = self.data[position + length:position + length + 32]
            if b"endstream" in tail:
                raw = candidate
        # /Length 不在或明显不对：直接找 endstream
        if raw is None:
            end = self.data.find(b"endstream", position)
            if end == -1:
                end = len(self.data)
            raw = self.data[position:end]
            # endstream 之前规范允许有一个换行：去掉它
            if raw.endswith(b"\r\n"):
                raw = raw[:-2]
            elif raw.endswith(b"\n") or raw.endswith(b"\r"):
                raw = raw[:-1]
        return _Stream(dictionary, raw)

    def object(self, number: int) -> Any:
        """Return object *number*, parsing it on first use."""
        # 解析过的直接用缓存
        if number in self.cache:
            return self.cache[number]
        # 循环引用（对象 A 的字典里又引用 A）：当成 null 收手
        if number in self.loading:
            return None
        self.loading.add(number)
        try:
            value: Any = None
            if number in self.offsets:
                value = self._parse_object_at(self.offsets[number])
            elif number in self.compressed:
                value = self._object_from_stream(*self.compressed[number])
        finally:
            self.loading.discard(number)
        self.cache[number] = value
        return value

    def _object_from_stream(self, container: int, index: int) -> Any:
        """Pull one object out of an object stream (``/ObjStm``)."""
        holder = self.object(container)
        if not isinstance(holder, _Stream):
            return None
        data = decode_stream(holder, self.resolve)
        entries = self._stream_index(holder, data)
        # 序号越界（坏文件）：当作没有这个对象
        if index >= len(entries):
            return None
        parser = _Parser(data)
        parser.pos = entries[index][1]
        return parser.parse_object()

    def _stream_index(self, holder: _Stream, data: bytes) -> List[Tuple[int, int]]:
        """Return ``[(object number, byte offset), ...]`` of an object stream."""
        # 头里写着条数与第一项的起点
        count = int(self.resolve(holder.dictionary.get("N", 0)) or 0)
        first = int(self.resolve(holder.dictionary.get("First", 0)) or 0)
        parser = _Parser(data)
        entries: List[Tuple[int, int]] = []
        # 流开头是 N 对「对象号 相对偏移」（偏移相对 First）
        for _ in range(max(0, count)):
            parser.skip_space()
            number_token = parser.read_token()
            parser.skip_space()
            offset_token = parser.read_token()
            # 头读不下去就别硬撑
            if not number_token.isdigit() or not offset_token.isdigit():
                break
            entries.append((int(number_token), first + int(offset_token)))
        return entries

    def _scan_objects(self) -> None:
        """Find every ``N G obj`` by scanning the file -- the fallback for a
        broken (or missing) cross reference table."""
        # 同一个对象号出现多次时，靠后的那份（通常是完整的那份）赢
        for match in _OBJECT_HEADER.finditer(self.data):
            self.offsets[int(match.group(1))] = match.start()
        # 扫描只看得到对象流的**容器**，里面的对象要另外登记
        self._expand_object_streams()
        # trailer 丢了：自己把 /Root 与 /Info 找回来
        if not isinstance(self.trailer.get("Root"), _Ref):
            for number in list(self.offsets):
                value = self.object(number)
                if isinstance(value, dict) and str(value.get("Type")) == "Catalog":
                    self.trailer["Root"] = _Ref(number)
                    break
        if self.trailer.get("Info") is None:
            for number in list(self.offsets):
                value = self.object(number)
                # /Info 没有 /Type，只能按里面的键认
                if isinstance(value, dict) and isinstance(value.get("Producer") or value.get("Title"), str):
                    self.trailer["Info"] = _Ref(number)
                    break

    def _expand_object_streams(self) -> None:
        """Register the objects packed inside every ``/ObjStm`` container."""
        for number in list(self.offsets):
            holder = self.object(number)
            # 只看流对象，而且 /Type 得是 /ObjStm
            if not isinstance(holder, _Stream) or str(holder.dictionary.get("Type")) != "ObjStm":
                continue
            data = decode_stream(holder, self.resolve)
            # 头里的对象号 + 偏移就是这批对象的索引
            for index, (target, _offset) in enumerate(self._stream_index(holder, data)):
                # 已经知道的（比如扫描也扫到了）不覆盖
                if target not in self.offsets and target not in self.compressed:
                    self.compressed[target] = (number, index)

    def resolve(self, value: Any) -> Any:
        """Follow indirect references until a direct object shows up."""
        # 引用链条正常只有几级；太深就当坏文件收手
        for _ in range(64):
            if not isinstance(value, _Ref):
                return value
            value = self.object(value.number)
        raise PdfError("reference chain is too deep")

    def catalog(self) -> Dict[Any, Any]:
        """The document catalog (``/Root``); ``{}`` when it cannot be found."""
        root = self.resolve(self.trailer.get("Root"))
        return root if isinstance(root, dict) else {}

    def info(self) -> Dict[Any, Any]:
        """The ``/Info`` dictionary (title / author / producer), if any."""
        info = self.resolve(self.trailer.get("Info"))
        return info if isinstance(info, dict) else {}


# ----------------------------------------------------------------------- 字体
# 简单字体的标准编码名 → Python 编解码器（StandardEncoding 没有对应编解码器，
# 单独走下面那张特例表）
_BASE_ENCODINGS: Dict[str, str] = {
    "WinAnsiEncoding": "cp1252",
    "MacRomanEncoding": "mac_roman",
    "MacExpertEncoding": "mac_roman",
}
# StandardEncoding 与 ASCII 重合的部分直接用 code 本身，其余特例列在这里
_STANDARD_SPECIALS: Dict[int, str] = {
    0x27: "\u2019",   # quoteright
    0x60: "\u2018",   # quoteleft
    0xA0: " ",        # 规范里 0xA0 就是空格
    0xAD: "-",        # hyphen
    0xB7: "\u2022",   # bullet
    0xE1: "\u00C6",   # AE
    0xF1: "\u00E6",   # ae
    0xF5: "\u0131",   # dotlessi
}
# 中文标点：这些字符前面不该补空格（PDF 里的字距会被我们误判成"词间距"）
_NO_SPACE_BEFORE = "、。，．：；！？）》」』】”’…—·"
# 这些字符后面同样不该补（开引号 / 开括号永远贴着下一个字）
_NO_SPACE_AFTER = "（《「『【“‘"


# 常见字形名 → 字符（/Differences 用的就是这些名字）；单个字母的名字就是它自己
_GLYPH_NAMES: Dict[str, str] = {
    "space": " ", "exclam": "!", "quotedbl": '"', "numbersign": "#",
    "dollar": "$", "percent": "%", "ampersand": "&", "quotesingle": "'",
    "parenleft": "(", "parenright": ")", "asterisk": "*", "plus": "+",
    "comma": ",", "hyphen": "-", "period": ".", "slash": "/",
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "colon": ":", "semicolon": ";", "less": "<", "equal": "=",
    "greater": ">", "question": "?", "at": "@",
    "bracketleft": "[", "backslash": "\\", "bracketright": "]",
    "asciicircum": "^", "underscore": "_", "grave": "`",
    "braceleft": "{", "bar": "|", "braceright": "}", "asciitilde": "~",
    "quoteleft": "\u2018", "quoteright": "\u2019",
    "quotedblleft": "\u201c", "quotedblright": "\u201d",
    "quotesinglbase": "\u201a", "quotedblbase": "\u201e",
    "endash": "\u2013", "emdash": "\u2014", "ellipsis": "\u2026",
    "bullet": "\u2022", "dagger": "\u2020", "daggerdbl": "\u2021",
    "section": "\u00a7", "paragraph": "\u00b6", "periodcentered": "\u00b7",
    "guillemotleft": "\u00ab", "guillemotright": "\u00bb",
    "guilsinglleft": "\u2039", "guilsinglright": "\u203a",
    "degree": "\u00b0", "plusminus": "\u00b1", "multiply": "\u00d7",
    "divide": "\u00f7", "copyright": "\u00a9", "registered": "\u00ae",
    "trademark": "\u2122", "euro": "\u20ac", "sterling": "\u00a3",
    "yen": "\u00a5", "cent": "\u00a2", "nbspace": " ", "sfthyphen": "-",
    "fi": "fi", "fl": "fl", "ff": "ff", "ffi": "ffi", "ffl": "ffl",
    # 希腊字母（数学 / 物理书里很常见）
    "alpha": "\u03b1", "beta": "\u03b2", "gamma": "\u03b3", "delta": "\u03b4",
    "epsilon": "\u03b5", "zeta": "\u03b6", "eta": "\u03b7", "theta": "\u03b8",
    "iota": "\u03b9", "kappa": "\u03ba", "lambda": "\u03bb", "mu": "\u03bc",
    "nu": "\u03bd", "xi": "\u03be", "omicron": "\u03bf", "pi": "\u03c0",
    "rho": "\u03c1", "sigma": "\u03c3", "tau": "\u03c4", "upsilon": "\u03c5",
    "phi": "\u03c6", "chi": "\u03c7", "psi": "\u03c8", "omega": "\u03c9",
    "Alpha": "\u0391", "Beta": "\u0392", "Gamma": "\u0393", "Delta": "\u0394",
    "Epsilon": "\u0395", "Zeta": "\u0396", "Eta": "\u0397", "Theta": "\u0398",
    "Iota": "\u0399", "Kappa": "\u039a", "Lambda": "\u039b", "Mu": "\u039c",
    "Nu": "\u039d", "Xi": "\u039e", "Omicron": "\u039f", "Pi": "\u03a0",
    "Rho": "\u03a1", "Sigma": "\u03a3", "Tau": "\u03a4", "Upsilon": "\u03a5",
    "Phi": "\u03a6", "Chi": "\u03a7", "Psi": "\u03a8", "Omega": "\u03a9",
    "AE": "\u00c6", "ae": "\u00e6", "OE": "\u0152", "oe": "\u0153",
    "germandbls": "\u00df", "exclamdown": "\u00a1", "questiondown": "\u00bf",
    "listitem": "\u2022", "brokenbar": "\u00a6", "currency": "\u00a4",
    "ordfeminine": "\u00aa", "ordmasculine": "\u00ba",
    "logicalnot": "\u00ac", "dieresis": "\u00a8", "acute": "\u00b4",
}


def _glyph_text(name: str) -> str:
    """Turn one glyph name (``/f_i``, ``uni4E2D``, ``a``...) into text."""
    # 去掉 AGL 的变体后缀：`a.sc` / `one.oldstyle` 都按 `a` / `one` 认
    base = name.split(".", 1)[0]
    # 单个字母就是它自己
    if len(base) == 1:
        return base
    # uniXXXX / uniXXXXYYYY（后者是多个字符）
    if base.startswith("uni") and len(base) > 6:
        text = ""
        digits = base[3:]
        for start in range(0, len(digits) - 3, 4):
            try:
                text += chr(int(digits[start:start + 4], 16))
            except ValueError:
                return ""
        return text
    # uXXXX 这种四位写法
    if base.startswith("u") and len(base) in (5, 7):
        try:
            return chr(int(base[1:], 16))
        except ValueError:
            return ""
    return _GLYPH_NAMES.get(base, "")


def _decode_utf16(raw: bytes) -> str:
    """Decode a CMap target string (UTF-16BE, usually with a BOM)."""
    # CMap 的目标串几乎总是带 BOM 的 UTF-16
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", errors="ignore")
    if raw.startswith(b"\xff\xfe"):
        return raw[2:].decode("utf-16-le", errors="ignore")
    return raw.decode("utf-16-be", errors="ignore")


def _increment_target(raw: bytes, offset: int) -> str:
    """``bfrange`` 的递增目标：整个目标串只有最后一位往上加。"""
    text = _decode_utf16(raw)
    # 空目标（坏文件）就当没有
    if not text:
        return ""
    return text[:-1] + chr(ord(text[-1]) + offset)


def _to_unicode_map(document: _Document, value: Any) -> Dict[int, str]:
    """Parse a ``/ToUnicode`` CMap into ``{character code: text}``.

    This is what makes CJK PDFs readable: the fonts are usually subset CID fonts
    whose byte codes mean nothing on their own, and the CMap is the only place
    that says which code is which character.
    """
    mapping: Dict[int, str] = {}
    stream = document.resolve(value)
    # 不是流（或者压根没有 /ToUnicode）：交给调用方走编码表
    if not isinstance(stream, _Stream):
        return mapping
    try:
        data = decode_stream(stream, document.resolve)
    except PdfError:
        return mapping
    parser = _Parser(data)
    # CMap 文件本身也是 PDF 风格的对象语法，逐段读
    while not parser.at_end():
        try:
            token = parser.parse_object()
        except PdfError:
            break
        # bfchar：两两一对（源码 → 目标串）
        if token == "beginbfchar":
            while True:
                try:
                    source = parser.parse_object()
                    target = parser.parse_object()
                except PdfError:
                    break
                # 段尾
                if source == "endbfchar" or target == "endbfchar":
                    break
                if isinstance(source, bytes) and isinstance(target, bytes):
                    mapping[int.from_bytes(source, "big")] = _decode_utf16(target)
        # bfrange：三元组（起、止、目标串或目标表）
        elif token == "beginbfrange":
            while True:
                try:
                    low = parser.parse_object()
                    high = parser.parse_object()
                    target = parser.parse_object()
                except PdfError:
                    break
                if low == "endbfrange":
                    break
                if not isinstance(low, bytes) or not isinstance(high, bytes):
                    continue
                first = int.from_bytes(low, "big")
                last = int.from_bytes(high, "big")
                # 明确给了每个码的目标
                if isinstance(target, list):
                    for offset, item in enumerate(target):
                        if isinstance(item, bytes):
                            mapping[first + offset] = _decode_utf16(item)
                # 只给一个起点，后面逐码递增
                elif isinstance(target, bytes):
                    for offset in range(max(0, last - first) + 1):
                        mapping[first + offset] = _increment_target(target, offset)
    return mapping


def _simple_encoding(document: _Document, dictionary: Dict[Any, Any]) -> Dict[int, str]:
    """Build a simple font's ``{code: text}`` table from ``/Encoding``."""
    encoding = document.resolve(dictionary.get("Encoding"))
    base_name: Optional[str] = None
    differences: Any = None
    # /Encoding 要么是一个标准编码名
    if isinstance(encoding, str):
        base_name = str(encoding)
    # 要么是一个字典：/BaseEncoding + /Differences
    elif isinstance(encoding, dict):
        base = document.resolve(encoding.get("BaseEncoding"))
        if isinstance(base, str):
            base_name = str(base)
        differences = document.resolve(encoding.get("Differences"))
    codec = _BASE_ENCODINGS.get(base_name or "")
    table: Dict[int, str] = {}
    # 先铺一层基础编码
    for code in range(256):
        if codec is not None:
            try:
                character = bytes([code]).decode(codec)
            except UnicodeDecodeError:
                character = ""
        else:
            # 没有编解码器可用（StandardEncoding 或干脆没写）：ASCII 直接用，其余查特例表
            character = chr(code) if 32 <= code <= 126 else _STANDARD_SPECIALS.get(code, "")
        if character:
            table[code] = character
    # /Differences 是「编号 + 若干字形名」的混合列表
    if isinstance(differences, list):
        current = 0
        for item in differences:
            # 数字：下一个字形名从这一格开始
            if isinstance(item, (int, float)):
                current = int(item)
                continue
            if isinstance(item, str):
                text = _glyph_text(str(item))
                # 认得出就覆盖；认不出就保留基础编码给的那个字符
                if text:
                    table[current] = text
                current += 1
    return table


def _simple_widths(document: _Document, dictionary: Dict[Any, Any]) -> Tuple[Dict[int, float], float]:
    """Read a simple font's ``/Widths`` (1/1000 em) and its default width."""
    widths: Dict[int, float] = {}
    # 第一条宽度对应 /FirstChar 那个码
    first = document.resolve(dictionary.get("FirstChar"))
    start = int(first) if isinstance(first, (int, float)) else 0
    array = document.resolve(dictionary.get("Widths"))
    if isinstance(array, list):
        for offset, width in enumerate(array):
            value = document.resolve(width)
            if isinstance(value, (int, float)):
                widths[start + offset] = float(value)
    # 数组里没有的码位用 /MissingWidth（缺省 500）
    default = 500.0
    descriptor = document.resolve(dictionary.get("FontDescriptor"))
    if isinstance(descriptor, dict):
        missing = document.resolve(descriptor.get("MissingWidth"))
        if isinstance(missing, (int, float)):
            default = float(missing)
    return widths, default


def _cid_widths(document: _Document, descendant: Dict[Any, Any]) -> Tuple[Dict[int, float], float]:
    """Read a CID font's ``/W`` array and its ``/DW`` default."""
    widths: Dict[int, float] = {}
    default_value = document.resolve(descendant.get("DW"))
    default = float(default_value) if isinstance(default_value, (int, float)) else 1000.0
    array = document.resolve(descendant.get("W"))
    if not isinstance(array, list):
        return widths, default
    # /W 混排两种写法：[c [w w w]] 与 [c1 c2 w]
    index = 0
    while index < len(array):
        first = document.resolve(array[index])
        index += 1
        if not isinstance(first, (int, float)) or index >= len(array):
            continue
        value = document.resolve(array[index])
        index += 1
        # 一串宽度：从 first 起每个码一个
        if isinstance(value, list):
            for offset, width in enumerate(value):
                resolved = document.resolve(width)
                if isinstance(resolved, (int, float)):
                    widths[int(first) + offset] = float(resolved)
        # 区间宽度：[c1 c2 w] —— 第二个数是**上界**，第三个数才是宽度
        elif isinstance(value, (int, float)) and index < len(array):
            width = document.resolve(array[index])
            index += 1
            if isinstance(width, (int, float)):
                for code in range(int(first), int(value) + 1):
                    widths[code] = float(width)
    return widths, default


def _sfnt_tables(data: bytes) -> Dict[str, bytes]:
    """Slice the tables of an sfnt (TrueType / OpenType) font program."""
    # 头部 12 字节：版本(4) + 表数(2) + 搜索参数(6)
    if len(data) < 12:
        return {}
    count = int.from_bytes(data[4:6], "big")
    tables: Dict[str, bytes] = {}
    for index in range(max(0, count)):
        record = data[12 + index * 16:12 + index * 16 + 16]
        # 记录表被截断（坏文件）就收手
        if len(record) < 16:
            break
        tag = record[0:4].decode("latin-1")
        offset = int.from_bytes(record[8:12], "big")
        length = int.from_bytes(record[12:16], "big")
        # 越界的表直接不要
        if offset + length <= len(data):
            tables[tag] = data[offset:offset + length]
    return tables


def _truetype_widths(data: bytes) -> Tuple[Dict[int, float], Optional[float]]:
    """``hmtx`` advance widths of a TrueType program, in 1/1000 em.

    Returns ``(width per glyph id, width of the last entry)`` -- the second one is
    what the specification says every glyph past ``numberOfHMetrics`` uses.
    """
    tables = _sfnt_tables(data)
    head = tables.get("head")
    hhea = tables.get("hhea")
    hmtx = tables.get("hmtx")
    # 三张表缺一张就算不出宽度（可能是 CFF 字体，另有各表的写法）
    if head is None or hhea is None or hmtx is None or len(head) < 20 or len(hhea) < 36:
        return {}, None
    # head 偏移 18 是 unitsPerEm；hhea 偏移 34 是 numberOfHMetrics
    units = int.from_bytes(head[18:20], "big") or 1000
    count = int.from_bytes(hhea[34:36], "big")
    if count == 0:
        return {}, None
    widths: Dict[int, float] = {}
    # hmtx 每条 4 字节（宽度 2 + 左轴承 2）
    available = min(count, len(hmtx) // 4)
    last = 0
    for glyph in range(available):
        last = int.from_bytes(hmtx[glyph * 4:glyph * 4 + 2], "big")
        widths[glyph] = last * 1000.0 / units
    # 一条都没读出来：交给调用方用 /DW
    if not widths:
        return {}, None
    return widths, last * 1000.0 / units


def _embedded_widths(document: _Document, descendant: Dict[Any, Any]) -> Tuple[Dict[int, float], Optional[float]]:
    """Widths read from an embedded TrueType program, keyed by glyph id.

    Subset fonts often ship an **empty** ``/W`` array: the producer knew the real
    widths when it wrote the positioning operators, but it did not record them in
    the font dictionary.  Without them every glyph looks like it left a gap and
    Latin words come out as ``Py tho n``.  The numbers are in the font program
    itself, so they are read from its ``hmtx`` table.  ``/CIDToGIDMap /Identity``
    -- what every writer here emits -- makes the glyph id equal to the CID.
    """
    descriptor = document.resolve(descendant.get("FontDescriptor"))
    if not isinstance(descriptor, dict):
        return {}, None
    # TrueType 是 FontFile2；FontFile3 是 CFF，这里不解析
    program = document.resolve(descriptor.get("FontFile2"))
    if not isinstance(program, _Stream):
        return {}, None
    try:
        data = decode_stream(program, document.resolve)
    except PdfError:
        return {}, None
    return _truetype_widths(data)


class _Font:
    """One font resource: the code→text map plus the widths that move the pen."""

    __slots__ = ("bytes_per_code", "codes", "widths", "default_width")

    def __init__(
        self,
        bytes_per_code: int,
        codes: Dict[int, str],
        widths: Dict[int, float],
        default_width: float,
    ) -> None:
        # CID 字体一个码两个字节，简单字体一个字节
        self.bytes_per_code = bytes_per_code
        # 码 → 字符（/ToUnicode 优先，其次 /Encoding）
        self.codes = codes
        # 每个码的宽度（1/1000 em）
        self.widths = widths
        # 表里没有的码用这个宽度
        self.default_width = default_width

    def text(self, raw: bytes) -> str:
        """Turn one string operand into Unicode text."""
        # 一位一组或两位一组地走完整个串
        step = self.bytes_per_code
        out: List[str] = []
        for start in range(0, len(raw) - step + 1, step):
            code = int.from_bytes(raw[start:start + step], "big")
            character = self.codes.get(code)
            # 一位编码的未知码位：ASCII 范围直接用它（很多老文件就靠这个）
            if character is None:
                character = chr(code) if step == 1 and 32 <= code < 127 else ""
            out.append(character)
        return "".join(out)

    def width(self, code: int) -> float:
        """The advance width of one character code, in 1/1000 em."""
        return self.widths.get(code, self.default_width)

    def advance(self, raw: bytes, font_size: float, char_spacing: float, word_spacing: float) -> float:
        """How far the pen moves after showing *raw*, in unscaled text units."""
        total = 0.0
        step = self.bytes_per_code
        for start in range(0, len(raw) - step + 1, step):
            code = int.from_bytes(raw[start:start + step], "big")
            # 宽度按字号缩放
            total += self.width(code) / 1000.0 * font_size + char_spacing
            # 规范：只有单字节码 32 才加词间距
            if step == 1 and code == 32:
                total += word_spacing
        return total


def load_font(document: _Document, dictionary: Dict[Any, Any]) -> _Font:
    """Build a :class:`_Font` from one font dictionary."""
    subtype = str(dictionary.get("Subtype") or "")
    unicode_map = _to_unicode_map(document, dictionary.get("ToUnicode"))
    # Type0（CID 字体）：两位一组，宽度写在子字体里
    if subtype == "Type0":
        descendants = document.resolve(dictionary.get("DescendantFonts"))
        child: Dict[Any, Any] = {}
        if isinstance(descendants, list) and descendants:
            first = document.resolve(descendants[0])
            if isinstance(first, dict):
                child = first
        widths, default = _cid_widths(document, child)
        # 子集字体常常带着一个空的 /W：真实宽度在字体程序里，读出来兜底
        embedded, embedded_default = _embedded_widths(document, child)
        if embedded:
            had_widths = bool(widths)
            merged = dict(embedded)
            merged.update(widths)
            widths = merged
            # /W 一个字都没写：默认宽度也用程序里的最后一条（比 /DW 准得多）
            if not had_widths and embedded_default is not None:
                default = embedded_default
        return _Font(2, unicode_map, widths, default)
    # 简单字体：一位一组，/ToUnicode 优先，缺的码位用 /Encoding 补
    codes = _simple_encoding(document, dictionary)
    codes.update(unicode_map)
    widths, default = _simple_widths(document, dictionary)
    return _Font(1, codes, widths, default)


# ------------------------------------------------------------------- 页面与正文
def _pdf_text(raw: bytes) -> str:
    """Decode a PDF *text string* (UTF-16BE with BOM, else PDFDocEncoding)."""
    # 带 BOM 的就是 UTF-16
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", errors="ignore")
    if raw.startswith(b"\xff\xfe"):
        return raw[2:].decode("utf-16-le", errors="ignore")
    # PDFDocEncoding 与 cp1252 只差几个位置，按 cp1252 解足够用
    return raw.decode("cp1252", errors="replace")


def page_list(document: _Document) -> List[Tuple[Dict[Any, Any], Dict[Any, Any]]]:
    """Return ``[(page dictionary, inherited resources), ...]`` in reading order."""
    catalog = document.catalog()
    root = document.resolve(catalog.get("Pages"))
    found: List[Tuple[Dict[Any, Any], Dict[Any, Any]]] = []
    # /Resources 这类属性可以挂在 /Pages 上由子节点继承，得一路带下去
    visited: Set[int] = set()
    _walk_pages(document, root, {}, found, visited, 0)
    return found


def _walk_pages(
    document: _Document,
    node: Any,
    inherited: Dict[Any, Any],
    found: List[Tuple[Dict[Any, Any], Dict[Any, Any]]],
    visited: Set[int],
    depth: int,
) -> None:
    """Depth-first walk of the page tree, collecting the ``/Type /Page`` nodes."""
    # 坏文件里 /Kids 可能成环：限深 + 记已访问
    if depth > 64 or not isinstance(node, dict):
        return
    # 这一层自己的 /Resources 覆盖继承下来的
    resources = document.resolve(node.get("Resources"))
    if isinstance(resources, dict):
        inherited = resources
    kind = str(node.get("Type") or "")
    kids = node.get("Kids")
    # 叶子（/Type /Page，或者干脆没有 /Kids）就是一页
    if kind == "Page" or (kind != "Pages" and not isinstance(kids, list)):
        found.append((node, inherited))
        return
    if not isinstance(kids, list):
        return
    for kid in kids:
        # 间接引用先登记，防止同一棵子树被走两次
        if isinstance(kid, _Ref):
            if kid.number in visited:
                continue
            visited.add(kid.number)
        _walk_pages(document, document.resolve(kid), inherited, found, visited, depth + 1)


class _TextState:
    """The text half of the graphics state, plus one page's font resources.

    A single instance replays a single content stream: it keeps the text and line
    matrices, the spacing parameters and the current font, and turns ``Tj`` /
    ``TJ`` / ``'`` / ``"`` into lines of text.  A ``Do`` on a form XObject gets a
    nested instance (see :meth:`_do_xobject`).
    """

    __slots__ = (
        "document", "resources", "depth", "fonts", "font", "font_size",
        "char_spacing", "word_spacing", "h_scale", "leading",
        "text_matrix", "line_matrix", "lines", "line", "last_x", "last_y",
    )

    def __init__(self, document: _Document, resources: Dict[Any, Any], depth: int = 0) -> None:
        # 文件与这一页（可能是表单）的资源字典
        self.document = document
        self.resources = resources if isinstance(resources, dict) else {}
        # 表单 XObject 套了几层（防环）
        self.depth = depth
        # 资源名 → 字体（第一次用到才解析）
        self.fonts: Dict[str, Optional[_Font]] = {}
        # 当前字体与字号
        self.font: Optional[_Font] = None
        self.font_size = 0.0
        # Tc 字间距 / Tw 词间距 / Tz 横向缩放（百分数）
        self.char_spacing = 0.0
        self.word_spacing = 0.0
        self.h_scale = 1.0
        # TL 行距
        self.leading = 0.0
        # 文本矩阵与行矩阵（只有平移那两位 e / f 用得上）
        self.text_matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        self.line_matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        # 已经成形的行 / 正在拼的这一行
        self.lines: List[str] = []
        self.line: List[str] = []
        # 上一段文字结束时的笔位（判断换行与补空格）
        self.last_x: Optional[float] = None
        self.last_y: Optional[float] = None

    def run(self, data: bytes) -> str:
        """Replay one content stream and return its text."""
        parser = _Parser(data)
        operands: List[Any] = []
        while not parser.at_end():
            try:
                token = parser.parse_object()
            except PdfError:
                break
            # 关键字就是操作符：拿着攒下的操作数去执行
            if isinstance(token, _Keyword):
                try:
                    self._operate(str(token), operands)
                except PdfError:
                    # 一个操作符出错不该毁掉整页
                    pass
                operands = []
                continue
            operands.append(token)
            # 坏文件里操作数会一直堆：只留最近 64 个
            if len(operands) > 64:
                del operands[:-64]
        # 收尾：最后一行也要落地
        self._flush()
        return "\n".join(self.lines)

    def _operate(self, operator: str, args: List[Any]) -> None:
        """Carry out one content-stream operator."""
        # 文字块开始 / 结束：矩阵复位（**不**收行 —— 很多生产者把同一行的
        # 每一小段都写成一个独立的 BT/ET 块，见下面的 _show）
        if operator == "BT":
            self.text_matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
            self.line_matrix = list(self.text_matrix)
        elif operator == "ET":
            pass
        # Tf：选字体 + 字号
        elif operator == "Tf":
            name = self._name_arg(args, -2)
            size = self._number_arg(args, -1)
            if name is not None:
                self.font = self._font(name)
            if size is not None:
                self.font_size = size
        # 三个间距参数
        elif operator == "Tc":
            value = self._number_arg(args, -1)
            if value is not None:
                self.char_spacing = value
        elif operator == "Tw":
            value = self._number_arg(args, -1)
            if value is not None:
                self.word_spacing = value
        elif operator == "Tz":
            value = self._number_arg(args, -1)
            if value is not None:
                self.h_scale = value / 100.0
        elif operator == "TL":
            value = self._number_arg(args, -1)
            if value is not None:
                self.leading = value
        # 换行与定位
        elif operator == "Td":
            self._translate(self._number_arg(args, -2) or 0.0, self._number_arg(args, -1) or 0.0)
        elif operator == "TD":
            ty = self._number_arg(args, -1) or 0.0
            self.leading = -ty
            self._translate(self._number_arg(args, -2) or 0.0, ty)
        elif operator == "Tm":
            self._set_matrix(args)
        elif operator == "T*":
            self._translate(0.0, -self.leading)
        # 显示文字
        elif operator == "Tj":
            raw = self._string_arg(args, -1)
            if raw is not None:
                self._show(raw)
        elif operator == "'":
            self._translate(0.0, -self.leading)
            raw = self._string_arg(args, -1)
            if raw is not None:
                self._show(raw)
        elif operator == '"':
            word = self._number_arg(args, -3)
            char = self._number_arg(args, -2)
            if word is not None:
                self.word_spacing = word
            if char is not None:
                self.char_spacing = char
            self._translate(0.0, -self.leading)
            raw = self._string_arg(args, -1)
            if raw is not None:
                self._show(raw)
        elif operator == "TJ":
            if args and isinstance(args[-1], list):
                self._show_array(args[-1])
        # 表单 XObject 里可能还写着字
        elif operator == "Do":
            name = self._name_arg(args, -1)
            if name is not None:
                self._do_xobject(name)
        # 其余操作符（画线、贴图、颜色、路径……）与正文无关，直接忽略

    @staticmethod
    def _number_arg(args: List[Any], index: int) -> Optional[float]:
        """The number at *index* (counted from the end of the operand stack)."""
        if not args or index < -len(args):
            return None
        value = args[index]
        # bool 是 int 的子类，这里要挡掉
        return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None

    @staticmethod
    def _string_arg(args: List[Any], index: int) -> Optional[bytes]:
        """The string at *index* (counted from the end of the operand stack)."""
        if not args or index < -len(args):
            return None
        value = args[index]
        return value if isinstance(value, bytes) else None

    @staticmethod
    def _name_arg(args: List[Any], index: int) -> Optional[str]:
        """The name at *index* (counted from the end of the operand stack).

        ``Tf`` and ``Do`` name a resource, and a name is **not** a string: the two
        are different operand types in the syntax, which is why this is separate
        from :meth:`_string_arg`.
        """
        if not args or index < -len(args):
            return None
        value = args[index]
        # _Name 是 str 的子类；字符串操作数（bytes）到这里应当返回 None
        return str(value) if isinstance(value, _Name) else None

    def _translate(self, tx: float, ty: float) -> None:
        """``Td`` / ``TD`` / ``T*``: move the line (and text) origin.

        The matrices are multiplied the way the spec says (there is no line break
        here on purpose: whether a line ends is decided in :meth:`_show`, where
        the real position of the next piece of text is known).
        """
        a, b, c, d, _e, f = self.line_matrix
        self.line_matrix = [
            a,
            b,
            c,
            d,
            self.line_matrix[4] + tx * a + ty * c,
            f + tx * b + ty * d,
        ]
        self.text_matrix = list(self.line_matrix)

    def _set_matrix(self, args: List[Any]) -> None:
        """``Tm``: set both matrices from six numbers (absolute position)."""
        numbers = [self._number_arg(args, -6 + offset) for offset in range(6)]
        # 六个操作数缺一个就整条跳过
        if any(number is None for number in numbers):
            return
        matrix = [float(number) for number in numbers if number is not None]
        # Tm 只给位置：换行与否交给下一段文字（_show 比 y）判断
        self.text_matrix = matrix
        self.line_matrix = list(matrix)

    def _show(self, raw: bytes) -> None:
        """Show one string operand, inserting spaces / line breaks as needed."""
        font = self.font
        # 还没碰到 Tf：这一段没法解
        if font is None:
            return
        text = font.text(raw)
        if not text:
            return
        x = self.text_matrix[4]
        y = self.text_matrix[5]
        size = abs(self.font_size) or 1.0
        # 与上一段的位置比：纵向差得多 = 换行，横向差得多 = 补一个空格
        if self.last_x is not None and self.last_y is not None:
            if abs(y - self.last_y) > 0.3 * size:
                self._flush()
            elif x - self.last_x > 0.2 * size and self._wants_space(text):
                self._pad()
        self.line.append(text)
        # 推进笔位：宽度按字号与横向缩放换算
        advance = font.advance(raw, self.font_size, self.char_spacing, self.word_spacing)
        self.text_matrix[4] = x + advance * self.h_scale
        self.last_x = self.text_matrix[4]
        self.last_y = y

    def _show_array(self, items: List[Any]) -> None:
        """``TJ``: strings interleaved with kerning offsets."""
        for item in items:
            # 字符串片段照常显示
            if isinstance(item, bytes):
                self._show(item)
                continue
            # 数字表示「把笔往回拉这么多」（负数 = 往右让开）
            if isinstance(item, (int, float)) and not isinstance(item, bool):
                self.text_matrix[4] -= float(item) / 1000.0 * self.font_size * self.h_scale
                # 让开之后笔位也变了：空隙交给下一段的比较去判
                self.last_x = self.text_matrix[4]

    def _pad(self) -> None:
        """Make sure the current line ends with a single space."""
        if self.line and not self.line[-1].endswith(" "):
            self.line.append(" ")

    def _wants_space(self, text: str) -> bool:
        """Whether a gap before *text* should become a space.

        A gap is only proof of a space when the two sides could actually be
        separate words: a Chinese closing punctuation mark never starts a word,
        and an opening quote/bracket never ends one, so those gaps are just the
        PDF's own letter positioning and stay closed.
        """
        # 自己就以空格开头（生产者写了真的空格）
        if text.startswith(" "):
            return False
        # 下一个字符是中文收尾标点：不补
        if text[0] in _NO_SPACE_BEFORE:
            return False
        # 当前行末尾是开引号 / 开括号：也不补
        if self.line and self.line[-1][-1:] in _NO_SPACE_AFTER:
            return False
        return True

    def _flush(self) -> None:
        """Close the current line (if it has text) and forget the pen position."""
        text = "".join(self.line).strip()
        # 空行不留（阅读器按行算进度，空行只是噪声）
        if text:
            self.lines.append(text)
        self.line = []
        self.last_x = None
        self.last_y = None

    def _font(self, name: str) -> Optional[_Font]:
        """Look one font up in the page's ``/Font`` resources (cached)."""
        if name in self.fonts:
            return self.fonts[name]
        font: Optional[_Font] = None
        fonts = self.document.resolve(self.resources.get("Font"))
        if isinstance(fonts, dict):
            dictionary = self.document.resolve(fonts.get(name))
            if isinstance(dictionary, dict):
                try:
                    font = load_font(self.document, dictionary)
                except PdfError:
                    font = None
        self.fonts[name] = font
        return font

    def _do_xobject(self, name: str) -> None:
        """``Do``: a form XObject carries its own text (headers, footers...)."""
        # 太深就不追了（也防环）
        if self.depth >= 4:
            return
        xobjects = self.document.resolve(self.resources.get("XObject"))
        if not isinstance(xobjects, dict):
            return
        stream = self.document.resolve(xobjects.get(name))
        # 只认表单：图片 XObject 没有文字
        if not isinstance(stream, _Stream) or str(stream.dictionary.get("Subtype")) != "Form":
            return
        try:
            data = decode_stream(stream, self.document.resolve)
        except PdfError:
            return
        inner_resources = self.document.resolve(stream.dictionary.get("Resources"))
        inner = _TextState(self.document, inner_resources if isinstance(inner_resources, dict) else {}, self.depth + 1)
        text = inner.run(data)
        # 表单里的文字当一整段接在当前位置（真这么排版的文件很少，够用就行）
        if text:
            self._pad()
            self.line.append(text)


# --------------------------------------------------------------------- 对外接口
def _open(source: Path) -> _Document:
    """Read *source* and build its object table (raises :class:`PdfError`)."""
    try:
        data = source.read_bytes()
    except OSError as exc:
        raise PdfError("cannot read {}: {}".format(source, exc)) from exc
    # 头部必须是 %PDF（有些文件前面垫了几个字节的垃圾，所以只看开头一段）
    if b"%PDF-" not in data[:1024]:
        raise PdfError("not a PDF file: {}".format(source.name))
    document = _Document(data)
    document.load()
    # 一页都找不出来：索引坏得没法救
    if not page_list(document):
        raise PdfError("no page could be read from {}".format(source.name))
    return document


def page_text(document: _Document, page: Dict[Any, Any], resources: Dict[Any, Any]) -> str:
    """Replay one page's content stream(s) and return its text."""
    contents = document.resolve(page.get("Contents"))
    data = b""
    # /Contents 可能是一个流
    if isinstance(contents, _Stream):
        try:
            data = decode_stream(contents, document.resolve)
        except PdfError:
            data = b""
    # 也可能是一串流：拼起来才是一页的内容
    elif isinstance(contents, list):
        chunks: List[bytes] = []
        for item in contents:
            stream = document.resolve(item)
            if not isinstance(stream, _Stream):
                continue
            try:
                chunks.append(decode_stream(stream, document.resolve))
            except PdfError:
                continue
        data = b"\n".join(chunks)
    # 一条都没有（纯图片页）：这一页就没有文字
    if not data:
        return ""
    return _TextState(document, resources).run(data)


def page_count(source: Path) -> int:
    """How many pages *source* has.

    Cheap on purpose: the page tree is walked, but no content stream is replayed
    and no font is parsed -- so the importer can record the page count without
    paying for the text layer (that is only extracted when the reader asks for
    it, see ``library.convert_pdf``).
    """
    # 打开文件（顺带校验头部）再数 /Pages 下面的叶子
    document = _open(source)
    return len(page_list(document))


def extract_text(source: Path) -> str:
    """Return *source*'s text layer as plain text, one line per PDF line.

    Pages are separated by a newline and empty lines are dropped -- the same
    shape :func:`wreader.library.html_to_text` hands over for epub and mobi, so
    the line numbers the reader shows mean the same thing for every format.

    Raises :class:`PdfError` when the file has **no text layer at all** (a
    scanned book is a pile of images); the caller turns that into the usual
    "this file could not be imported" report instead of importing garbage.
    """
    document = _open(source)
    blocks: List[str] = []
    for page, resources in page_list(document):
        text = page_text(document, page, resources)
        # 空页（封面、整页插图）不占行
        if text.strip():
            blocks.append(text)
    joined = "\n".join(blocks)
    # 整本一页有字的都没有：说清楚是「没有文字层」，别让用户对着乱码猜
    if not joined.strip():
        raise PdfError("{} has no text layer (a scanned PDF? run OCR first)".format(source.name))
    return joined


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    """One PNG chunk: length + type + payload + CRC-32."""
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def _encode_png(document: _Document, stream: _Stream, data: bytes) -> Optional[Tuple[bytes, str]]:
    """Wrap raw 8-bit gray / RGB samples into a PNG image."""
    width = _stream_int(document, stream, "Width")
    height = _stream_int(document, stream, "Height")
    bits = _stream_int(document, stream, "BitsPerComponent") or 8
    space = str(document.resolve(stream.dictionary.get("ColorSpace")) or "")
    channels = {"DeviceGray": 1, "DeviceRGB": 3}.get(space)
    # 只认 8 位灰度 / RGB：索引色要先查调色板、别的位宽要拆位，不值得为一个封面去写
    if channels is None or bits != 8 or width <= 0 or height <= 0:
        return None
    stride = width * channels
    # 数据不够一整页（坏文件）就不硬编
    if len(data) < stride * height:
        return None
    # PNG 每行前面要一个「过滤器类型」字节，这里一律写 0（不过滤）
    raw = bytearray()
    for row in range(height):
        raw.append(0)
        raw += data[row * stride:(row + 1) * stride]
    header = struct.pack(">IIBBBBB", width, height, 8, 2 if channels == 3 else 0, 0, 0, 0)
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + _png_chunk(b"IEND", b"")
    )
    return payload, "image/png"


def _stream_int(document: _Document, stream: _Stream, key: str) -> int:
    """A stream dictionary entry as an integer (0 when it is not one)."""
    value = document.resolve(stream.dictionary.get(key))
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _image_bytes(document: _Document, stream: _Stream) -> Optional[Tuple[bytes, str]]:
    """The bytes of one image XObject, as a file we can write."""
    filters = document.resolve(stream.dictionary.get("Filter"))
    if isinstance(filters, str):
        names = [str(filters)]
    elif isinstance(filters, list):
        names = [str(item) for item in filters]
    else:
        names = []
    # JPEG 的流内容本身就是一张 .jpg：原样拿走，一个字节都不用动
    if names == ["DCTDecode"]:
        return stream.raw, "image/jpeg"
    # 别的过滤器要先解成像素，再自己编一张 PNG
    try:
        data = decode_stream(stream, document.resolve)
    except PdfError:
        return None
    return _encode_png(document, stream, data)


def extract_cover(source: Path) -> Optional[Tuple[bytes, str]]:
    """Best-effort: the biggest image on page one (usually the cover).

    Mirrors :func:`wreader.mobi.extract_cover` -- the bytes plus a media type, or
    ``None``.  ``library`` writes them next to the converted text, which is where
    the desktop shell looks for a cover.
    """
    document = _open(source)
    pages = page_list(document)
    if not pages:
        return None
    _page, resources = pages[0]
    xobjects = document.resolve(resources.get("XObject"))
    if not isinstance(xobjects, dict):
        return None
    best: Optional[Tuple[bytes, str]] = None
    best_size = 0
    # 第一页上最大的那张图当封面（比按名字猜 /Cover 稳）
    for name in list(xobjects):
        stream = document.resolve(xobjects.get(name))
        if not isinstance(stream, _Stream) or str(stream.dictionary.get("Subtype")) != "Image":
            continue
        found = _image_bytes(document, stream)
        if found is None:
            continue
        if len(found[0]) > best_size:
            best = found
            best_size = len(found[0])
    return best


def metadata(source: Path) -> Dict[str, str]:
    """The ``/Info`` dictionary as plain strings, plus the page count."""
    document = _open(source)
    info = document.info()
    out: Dict[str, str] = {}
    for key in ("Title", "Author", "Subject", "Creator", "Producer"):
        value = info.get(key)
        # /Info 的字符串要么是 PDFDocEncoding，要么是带 BOM 的 UTF-16
        if isinstance(value, bytes):
            out[key] = _pdf_text(value)
        elif isinstance(value, str):
            out[key] = str(value)
    out["Pages"] = str(len(page_list(document)))
    return out


