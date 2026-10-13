"""MOBI / AZW3 (KF8) text and cover extraction -- standard library only.

A MOBI file is a **Palm Database** (PDB): a 78 byte header, one 8 byte entry per
record, then the records themselves.  Record 0 is a PalmDOC header followed by the
MOBI header (and usually an EXTH block); records ``1..text_records`` hold the book
text; the records after that can be images, indexes and the ``FDST`` table.

``.azw3`` is the same container with ``version == 8``: the text records hold **KF8**
markup that has been split into a *skeleton* plus *fragments*, and the pieces have
to be reassembled before it reads like HTML.  This module does that too, so a
kindle book can be imported without Calibre installed.

Only two things are exposed and both are best-effort guesses at *content*:
:func:`extract_markup` (the book's markup, still HTML-ish) and :func:`extract_cover`
(the embedded cover image bytes).  Turning markup into plain text is
``library.html_to_text``'s job, and the title / author / chapters are decided there
too -- exactly like the epub path, so both formats behave the same way.
"""

# 延迟求值类型注解
from __future__ import annotations

# 定长字段的二进制解析（PDB / 记录 0 / INDX 都是大端整数）
import struct
# 把章节标题里的片段拼回来时要用正则
import re
# 路径处理
from pathlib import Path
# 类型注解
from typing import Callable, Dict, List, Optional, Tuple


# MOBI / AZW3 读不出来时统一抛这个异常（library 那边会转成自己的 LibraryError）
class MobiError(Exception):
    """Raised when a MOBI/AZW3 file cannot be understood."""


# PDB 文件头固定 78 字节
_PDB_HEADER = 78
# 每条记录在索引表里占 8 字节（4 字节偏移 + 1 字节属性 + 3 字节唯一号）
_RECORD_ENTRY = 8
# 索引表之后还有 2 字节对齐空隙
_RECORD_GAP = 2

# 记录 0 上的关键偏移（都相对记录 0 起点；前 16 字节是 PalmDOC 头）
_MOBI_MAGIC = b"MOBI"
_OFF_TEXT_LENGTH = 0x04
_OFF_TEXT_RECORDS = 0x08
_OFF_MAX_RECORD_SIZE = 0x0A
_OFF_ENCRYPTION = 0x0C
_OFF_HEADER_LENGTH = 0x14
_OFF_CODEPAGE = 0x1C
_OFF_VERSION = 0x24
_OFF_FIRST_RESOURCE = 0x6C
_OFF_HUFF_OFFSET = 0x70
_OFF_HUFF_NUM = 0x74
_OFF_EXTH_FLAGS = 0x80
_OFF_TRAILDATA_FLAGS = 0xF2
_OFF_FDST = 0xC0
_OFF_FDST_COUNT = 0xC4
_OFF_FRAGMENT_INDEX = 0xF8
_OFF_SKELETON_INDEX = 0xFC

# EXTH 类型里我们认得的两三个（其余一律不管）
_EXTH_AUTHOR = 100
_EXTH_TITLE = 503
_EXTH_COVER_OFFSET = 201

# 压缩方式：0x4448 是 "HD" 的十六进制，也就是 HUFF/CDIC
_COMPRESSION_NONE = 1
_COMPRESSION_PALMDOC = 2
_COMPRESSION_HUFFCDIC = 0x4448

# 编码页 → Python 编解码器名
_CODECS: Dict[int, str] = {
    1252: "cp1252",
    65001: "utf-8",
}


class _PalmDatabase:
    """The PDB container: header, record table and random access to records."""

    def __init__(self, data: bytes) -> None:
        # 太短连文件头都不够：直接报错
        if len(data) < _PDB_HEADER + _RECORD_GAP:
            raise MobiError("file is too short to be a Palm database")
        self.data = data
        # 库名（前 32 字节，C 风格以 0 结尾），出问题时能报得具体一点
        self.name = data[0:32].split(b"\x00")[0]
        # 记录条数在 76
        count = struct.unpack_from(">H", data, 76)[0]
        table_end = _PDB_HEADER + count * _RECORD_ENTRY + _RECORD_GAP
        # 索引表本身就超出文件：坏文件
        if table_end > len(data):
            raise MobiError("Palm database record table is truncated")
        # 每条记录的起始偏移；末尾补上文件长度，第 i 条就是 offsets[i]..offsets[i+1]
        offsets = [
            struct.unpack_from(">I", data, _PDB_HEADER + i * _RECORD_ENTRY)[0]
            for i in range(count)
        ]
        offsets.append(len(data))
        self.offsets = offsets
        self.record_count = count

    def record(self, index: int) -> bytes:
        """Return record *index* (0 based) as raw bytes."""
        # 越界（比如封面偏移撒谎）时报错，别让调用方拿到半个文件
        if index < 0 or index >= self.record_count:
            raise MobiError("record {} is out of range".format(index))
        return self.data[self.offsets[index]:self.offsets[index + 1]]


def _read_int(record: bytes, offset: int, size: int) -> int:
    """Read a big-endian unsigned integer out of *record*, or 0 if it is absent."""
    # 头短的旧文件里这些字段根本不存在：当作 0（= 没有），而不是抛错
    if offset + size > len(record):
        return 0
    return int(struct.unpack_from(">I", record, offset)[0]) if size == 4 else int(
        struct.unpack_from(">H", record, offset)[0]
    )


class _MobiHeader:
    """The PalmDOC + MOBI + EXTH headers that live in record 0."""

    def __init__(self, record0: bytes) -> None:
        # 记录 0 的前 16 字节是 PalmDOC 头，之后才轮到 MOBI 头
        if len(record0) < 20 or record0[16:20] != _MOBI_MAGIC:
            raise MobiError("record 0 is not a MOBI header")
        self.record0 = record0
        # PalmDOC 头
        self.compression = _read_int(record0, 0x00, 2)
        self.text_length = _read_int(record0, _OFF_TEXT_LENGTH, 4)
        self.text_records = _read_int(record0, _OFF_TEXT_RECORDS, 2)
        self.max_record_size = _read_int(record0, _OFF_MAX_RECORD_SIZE, 2)
        self.encryption = _read_int(record0, _OFF_ENCRYPTION, 2)
        # MOBI 头
        self.header_length = _read_int(record0, _OFF_HEADER_LENGTH, 4)
        self.codepage = _read_int(record0, _OFF_CODEPAGE, 4)
        self.version = _read_int(record0, _OFF_VERSION, 4)
        self.first_resource = _read_int(record0, _OFF_FIRST_RESOURCE, 4)
        # 0xFFFFFFFF 在这里的意思是"没有"，别当成第 42 亿条记录
        if self.first_resource == 0xFFFFFFFF:
            self.first_resource = self.text_records + 1
        self.huff_offset = _read_int(record0, _OFF_HUFF_OFFSET, 4)
        self.huff_num = _read_int(record0, _OFF_HUFF_NUM, 4)
        self.fdst = _read_int(record0, _OFF_FDST, 4)
        self.fdst_count = _read_int(record0, _OFF_FDST_COUNT, 4)
        # 少于两段 flow 时这个字段是垃圾值（老 MOBI 6 文件如此）
        if self.fdst_count <= 1:
            self.fdst = 0xFFFFFFFF
        self.fragment_index = _read_int(record0, _OFF_FRAGMENT_INDEX, 4)
        self.skeleton_index = _read_int(record0, _OFF_SKELETON_INDEX, 4)
        # 只有 8 版（KF8/AZW3）才认这套索引
        if self.version < 8:
            self.fragment_index = 0xFFFFFFFF
            self.skeleton_index = 0xFFFFFFFF
        # 编码：认不出就按 Windows-1252（MOBI 的默认）
        self.codec = _CODECS.get(self.codepage, "cp1252")
        self.exth = self._read_exth()
        # 记录尾巴上可能挂着多字节与填充，长度信息藏在 0xF2
        self.traildata_flags = 0
        if self.header_length >= 0xE4 and self.version >= 5:
            self.traildata_flags = _read_int(record0, _OFF_TRAILDATA_FLAGS, 2)

    def _read_exth(self) -> Dict[int, bytes]:
        """Return ``{type: payload}`` for the EXTH block (empty when absent)."""
        # 头尾各有一个"有没有 EXTH"的开关位
        flags = _read_int(self.record0, _OFF_EXTH_FLAGS, 4)
        if not flags & 0x40:
            return {}
        start = 16 + self.header_length
        length = _read_int(self.record0, start + 4, 4)
        block = self.record0[start:start + length]
        if len(block) < 12:
            return {}
        count = _read_int(block, 8, 4)
        payloads: Dict[int, bytes] = {}
        pos = 12
        for _ in range(count):
            # 一条记录至少 8 字节（类型 + 长度），坏了就到此为止
            if pos + 8 > len(block):
                break
            entry_type, size = struct.unpack_from(">II", block, pos)
            if size < 8:
                break
            # 同类取第一条（封面 / 标题都只认第一份）
            payloads.setdefault(entry_type, block[pos + 8:pos + size])
            pos += size
        return payloads

    def exth_int(self, entry_type: int) -> Optional[int]:
        """Return a 4 byte EXTH integer, or ``None`` when it is absent/unknown."""
        payload = self.exth.get(entry_type)
        if payload is None or len(payload) != 4:
            return None
        value = struct.unpack(">I", payload)[0]
        # 0xFFFFFFFF 表示"没有这一项"
        return None if value == 0xFFFFFFFF else value

    def is_kf8(self) -> bool:
        """True for a version 8 file (AZW3) whose skeleton index is usable."""
        # 版本 8 + 骨架索引存在，才敢按 KF8 拼正文
        return self.version >= 8 and self.skeleton_index != 0xFFFFFFFF


def _trim_trailing(record: bytes, trailers: int, multibyte: bool) -> bytes:
    """Drop the trailing-data / multibyte bytes a text record may end with."""
    # 每条尾部数据都以"长度写在最后 4 字节里"的形式倒着挂
    for _ in range(trailers):
        size = 0
        for byte in record[-4:]:
            if byte & 0x80:
                size = 0
            size = (size << 7) | (byte & 0x7F)
        if size <= 0 or size > len(record):
            break
        record = record[:-size]
    # 多字节（UTF-8）文本再砍掉最后那截不完整的字符
    if multibyte and record:
        record = record[:-(record[-1] & 0x03) - 1]
    return record


def _trailing_counts(flags: int) -> Tuple[int, bool]:
    """Return ``(trailer_count, multibyte)`` from the 0xF2 flags word."""
    # 最低位是多字节开关，其余置 1 的位各代表一条尾部数据
    multibyte = bool(flags & 1)
    trailers = 0
    flags >>= 1
    while flags:
        if flags & 1:
            trailers += 1
        flags >>= 1
    return trailers, multibyte



def _decompress_palmdoc(data: bytes) -> bytes:
    """Undo the PalmDOC LZ77 byte-pair compression of one text record."""
    out = bytearray()
    pos = 0
    size = len(data)
    while pos < size:
        byte = data[pos]
        pos += 1
        # 0x01..0x08：后面紧跟着这么多"原样照抄"的字节
        if 1 <= byte <= 8:
            out += data[pos:pos + byte]
            pos += byte
            continue
        # 0x00 / 0x09..0x7F：一个普通字符
        if byte < 0x80:
            out.append(byte)
            continue
        # 0xC0..0xFF：空格 + (这一字节异或 0x80) 那个字符
        if byte >= 0xC0:
            out.append(0x20)
            out.append(byte ^ 0x80)
            continue
        # 0x80..0xBF：14 位"往后多远 + 多长"，11 位距离 + 3 位长度
        if pos >= size:
            break
        pair = (byte << 8) | data[pos]
        pos += 1
        distance = (pair >> 3) & 0x07FF
        length = (pair & 0x07) + 3
        if distance == 0 or distance > len(out):
            raise MobiError("PalmDOC back-reference points outside the text")
        if distance > length:
            # 复制的那一段与当前写入位置不重叠：一次切片就够
            out += out[-distance:length - distance]
        else:
            # 会自我重叠（像 RLE）：一个字节一个字节往后叠
            for _ in range(length):
                out.append(out[-distance])
    return bytes(out)


class _HuffCdic:
    """The HUFF/CDIC (``0x4448``) decompressor used by most AZW3 files."""

    def __init__(self) -> None:
        # 快查表：256 项 (码长, 是不是终止, 该长度下的最大码)
        self.dict1: Tuple[Tuple[int, int, int], ...] = ()
        # 逐码长可以取到的最小码 / 最大码
        self.mincode: Tuple[int, ...] = ()
        self.maxcode: Tuple[int, ...] = ()
        # 词典短语：元素是 (bytes, 是否已展开)
        self.dictionary: List[Optional[Tuple[bytes, int]]] = []

    def load_huff(self, huff: bytes) -> None:
        """Read the HUFF table record (the first of the ``huff_num`` records)."""
        if huff[0:8] != b"HUFF\x00\x00\x00\x18":
            raise MobiError("invalid HUFF record")
        off1, off2 = struct.unpack_from(">LL", huff, 8)
        entries = []
        for raw in struct.unpack_from(">256L", huff, off1):
            # 低 5 位是码长、0x80 是终止位、高位是"该长度里最大的码 - 1"
            codelen = raw & 0x1F
            term = raw & 0x80
            maxcode = raw >> 8
            if codelen == 0:
                raise MobiError("HUFF table has a zero codelength")
            maxcode = ((maxcode + 1) << (32 - codelen)) - 1
            entries.append((codelen, term, maxcode))
        self.dict1 = tuple(entries)
        # 第二张表：每个码长一对 (mincode, maxcode)
        table2 = struct.unpack_from(">64L", huff, off2)
        self.mincode = tuple(
            mincode << (32 - codelen)
            for codelen, mincode in enumerate((0,) + table2[0::2])
        )
        self.maxcode = tuple(
            ((maxcode + 1) << (32 - codelen)) - 1
            for codelen, maxcode in enumerate((0,) + table2[1::2])
        )
        self.dictionary = []

    def load_cdic(self, cdic: bytes) -> None:
        """Append the phrases of one CDIC record to the dictionary."""
        if cdic[0:8] != b"CDIC\x00\x00\x00\x10":
            raise MobiError("invalid CDIC record")
        phrases, bits = struct.unpack_from(">LL", cdic, 8)
        # 这一条 CDIC 恰好带 1<<bits 个（最后一条可能不足）
        count = min(1 << bits, phrases - len(self.dictionary))
        if count <= 0:
            return
        offsets = struct.unpack_from(">%dH" % count, cdic, 16)
        for offset in offsets:
            length = struct.unpack_from(">H", cdic, 16 + offset)[0]
            # 每段短语：2 字节长度（最高位是"已展开"标志）+ 正文
            payload = cdic[18 + offset:18 + offset + (length & 0x7FFF)]
            self.dictionary.append((bytes(payload), length & 0x8000))


    def unpack(self, data: bytes) -> bytes:
        """Decode one compressed text record with the loaded tables."""
        bits_left = len(data) * 8
        # 末尾补 8 个 0：读 64 位窗口时越界，纯当占位
        data = data + b"\x00" * 8
        pos = 0
        window = struct.unpack_from(">Q", data, pos)[0]
        available = 32
        out = bytearray()
        while True:
            # 窗口里剩的位数不够了：往后挪 4 字节、补 32 位
            if available <= 0:
                pos += 4
                window = struct.unpack_from(">Q", data, pos)[0]
                available += 32
            code = (window >> available) & 0xFFFFFFFF
            codelen, term, maxcode = self.dict1[code >> 24]
            if not term:
                # 非终止码：顺着逐长度的最小码找到真正的码长
                while codelen < len(self.mincode) and code < self.mincode[codelen]:
                    codelen += 1
                if codelen >= len(self.maxcode):
                    raise MobiError("HUFF code length ran past the table")
                maxcode = self.maxcode[codelen]
            available -= codelen
            bits_left -= codelen
            # 已经把真正的正文读完了：剩下的都是填充位
            if bits_left < 0:
                break
            index = (maxcode - code) >> (32 - codelen)
            if index >= len(self.dictionary):
                raise MobiError("HUFF code points past the dictionary")
            entry = self.dictionary[index]
            if entry is None:
                raise MobiError("recursive HUFF dictionary entry")
            payload, expanded = entry
            if not expanded:
                # 词典短语自己也是压缩的：先标记"正在展开"挡住环，再递归
                self.dictionary[index] = None
                payload = self.unpack(payload)
                self.dictionary[index] = (payload, 1)
            out += payload
        return bytes(out)


def _build_decompressor(
    header: _MobiHeader, load_record: Callable[[int], bytes]
) -> Callable[[bytes], bytes]:
    """Return the decompression function the header's compression type asks for."""
    if header.compression == _COMPRESSION_NONE:
        return lambda chunk: chunk
    if header.compression == _COMPRESSION_PALMDOC:
        return _decompress_palmdoc
    if header.compression == _COMPRESSION_HUFFCDIC:
        reader = _HuffCdic()
        # 第 1 条是 HUFF 表，往后 huff_num-1 条是 CDIC 词典
        reader.load_huff(load_record(header.huff_offset))
        for i in range(1, header.huff_num):
            reader.load_cdic(load_record(header.huff_offset + i))
        return reader.unpack
    raise MobiError("unsupported compression type: 0x{:x}".format(header.compression))



# INDX 头里 13 个 4 字节字段的名字（顺序不能动）
_INDX_FIELDS = (
    "len", "nul1", "type", "gen", "start", "count", "code",
    "lng", "total", "ordt", "ligt", "nligt", "nctoc",
)


def _read_variable_width(data: bytes, offset: int) -> Tuple[int, int]:
    """Read one INDX variable-width integer; return ``(bytes used, value)``."""
    # 每字节 7 位，最高位是"到此为止"
    value = 0
    consumed = 0
    while offset + consumed < len(data):
        byte = data[offset + consumed]
        consumed += 1
        value = (value << 7) | (byte & 0x7F)
        if byte & 0x80:
            return consumed, value
    raise MobiError("truncated INDX variable-width value")


def _read_tagx(data: bytes, start: int) -> Tuple[int, List[Tuple[int, int, int, int]]]:
    """Read the TAGX section of an INDX record; return ``(control_bytes, tags)``."""
    if data[start:start + 4] != b"TAGX":
        raise MobiError("INDX record has no TAGX section")
    first_entry = struct.unpack_from(">L", data, start + 4)[0]
    control_byte_count = struct.unpack_from(">L", data, start + 8)[0]
    # 每条 tag 4 字节：(tag 号, 每项几个值, 掩码, 结束标志)
    tags = []
    for offset in range(12, first_entry, 4):
        pos = start + offset
        tags.append((data[pos], data[pos + 1], data[pos + 2], data[pos + 3]))
    return control_byte_count, tags


def _read_tag_map(
    control_byte_count: int,
    tag_table: List[Tuple[int, int, int, int]],
    data: bytes,
    start: int,
) -> Dict[int, List[int]]:
    """Turn one INDX entry's control bytes + values into ``{tag: values}``."""
    located: List[Tuple[int, Optional[int], Optional[int], int]] = []
    control_index = 0
    value_pos = start + control_byte_count
    for tag, values_per_entry, mask, end_flag in tag_table:
        # 结束标志那一字节不参与计数，但控制字节的位置要往前挪
        if end_flag == 0x01:
            control_index += 1
            continue
        value = data[start + control_index] & mask
        if value == 0:
            continue
        if value == mask:
            if bin(mask).count("1") > 1:
                # 掩码不止一位且全部置位：后面跟一个"总字节数"
                used, size = _read_variable_width(data, value_pos)
                value_pos += used
                located.append((tag, None, size, values_per_entry))
            else:
                located.append((tag, 1, None, values_per_entry))
        else:
            # 把掩码最低的置位对齐到最低位，得到实际计数
            shift = 0
            while not (mask >> shift) & 1:
                shift += 1
            located.append((tag, value >> shift, None, values_per_entry))
    result: Dict[int, List[int]] = {}
    for tag, value_count, value_bytes, values_per_entry in located:
        values: List[int] = []
        if value_count is not None:
            for _ in range(value_count):
                for _ in range(values_per_entry):
                    used, value = _read_variable_width(data, value_pos)
                    value_pos += used
                    values.append(value)
        else:
            consumed = 0
            while value_bytes is not None and consumed < value_bytes:
                used, value = _read_variable_width(data, value_pos)
                value_pos += used
                consumed += used
                values.append(value)
        result[tag] = values
    return result



def _read_index(
    load_record: Callable[[int], bytes], index_record: int
) -> Tuple[List[Tuple[bytes, Dict[int, List[int]]]], Dict[int, bytes]]:
    """Read one KF8 INDX index; return ``(entries, ctoc_strings)``.

    The main INDX record announces how many INDX records follow it; those carry
    the actual entries.  ``nctoc`` extra records hold the "ctoc" strings that the
    entries point into (fragment anchors live there).
    """
    data = load_record(index_record)
    if data[:4] != b"INDX":
        raise MobiError("index record is not INDX")
    header = dict(zip(_INDX_FIELDS, struct.unpack_from(">13L", data, 4)))
    index_count = int(header["count"])
    # ctoc 字符串分散在紧跟主 INDX 的那几条记录里，每条占 0x10000 个键位
    ctoc: Dict[int, bytes] = {}
    ctoc_start = index_record + index_count + 1
    for block in range(int(header["nctoc"])):
        payload = load_record(ctoc_start + block)
        offset = 0
        while offset < len(payload) and payload[offset] != 0:
            used, length = _read_variable_width(payload, offset)
            offset += used
            name = payload[offset:offset + length]
            offset += length
            ctoc[block * 0x10000 + (offset - length - used)] = name
    control_byte_count, tag_table = _read_tagx(data, int(header["len"]))
    entries: List[Tuple[bytes, Dict[int, List[int]]]] = []
    for i in range(index_record + 1, index_record + 1 + index_count):
        entry_data = load_record(i)
        info = dict(zip(_INDX_FIELDS, struct.unpack_from(">13L", entry_data, 4)))
        idxt_pos = int(info["start"])
        entry_count = int(info["count"])
        # IDXT 段落：'IDXT' + 每条 2 字节的起始偏移（最后一条到 IDXT 自身为止）
        positions = [
            struct.unpack_from(">H", entry_data, idxt_pos + 4 + 2 * j)[0]
            for j in range(entry_count)
        ]
        for j in range(entry_count):
            start_pos = positions[j]
            text_len = entry_data[start_pos]
            text = entry_data[start_pos + 1:start_pos + 1 + text_len]
            tag_map = _read_tag_map(
                control_byte_count, tag_table, entry_data,
                start_pos + 1 + text_len,
            )
            entries.append((text, tag_map))
    return entries, ctoc


def _kf8_markup(db: _PalmDatabase, header: _MobiHeader, raw: bytes) -> bytes:
    """Reassemble the KF8 markup from its skeleton + fragment pieces."""
    # FDST 是"每一段 flow 在 rawML 里的起点"，第一段就是正文
    fdst_record = db.record(header.fdst)
    if fdst_record[:4] != b"FDST":
        raise MobiError("KF8 file is missing its FDST record")
    section_count = struct.unpack_from(">L", fdst_record, 8)[0]
    # 每条 flow 记两个数（起止），只要起点；末尾补上整段长度
    starts = struct.unpack_from(">%dL" % (section_count * 2), fdst_record, 12)[::2]
    text = raw[starts[0]:starts[1]] if len(starts) > 1 else raw

    # 骨架：每一条是"这一章的外壳"，带碎片条数与在正文里的位置 / 长度
    skeleton_entries, _ = _read_index(db.record, header.skeleton_index)
    fragment_entries, fragment_ctoc = _read_index(db.record, header.fragment_index)
    skeletons = [
        (tag_map[1][0], tag_map[6][0], tag_map[6][1])
        for _text, tag_map in skeleton_entries
    ]
    fragments = []
    for text_bytes, tag_map in fragment_entries:
        # 碎片自带"插到哪一段、插在第几位、正文从哪取、取多少"
        insert_pos = int(text_bytes)
        anchor = fragment_ctoc.get(tag_map[2][0], b"")
        fragments.append((
            insert_pos, anchor,
            tag_map[3][0], tag_map[4][0], tag_map[6][0], tag_map[6][1],
        ))

    parts = []
    frag_ptr = 0
    for fragment_count, skeleton_pos, skeleton_len in skeletons:
        base = skeleton_pos + skeleton_len
        skeleton = text[skeleton_pos:base]
        for _ in range(fragment_count):
            insert_pos, _anchor, _file, _seq, start, length = fragments[frag_ptr]
            slice_ = text[base:base + length]
            # 插到这一段的骨架里（位置换算成相对骨架起点）
            relative = insert_pos - skeleton_pos
            skeleton = skeleton[:relative] + slice_ + skeleton[relative:]
            base += length
            frag_ptr += 1
        parts.append(skeleton)
    return b"".join(parts)



# <mbp:pagebreak .../> 是 MOBI 的"分页"，换成 <br> 好让 html_to_text 断行
_PAGE_BREAK = re.compile(r"(?i)<mbp:pagebreak[^>]*>")


def extract_markup(source: Path) -> Tuple[str, str]:
    """Return ``(markup, codec_name)`` for a MOBI / AZW3 book.

    The markup is still HTML-ish; run it through ``library.html_to_text`` to get
    the plain text.  ``codec_name`` is what the header declares, for the record's
    ``encoding`` field.
    """
    db = _PalmDatabase(source.read_bytes())
    header = _MobiHeader(db.record(0))
    if header.encryption != 0:
        raise MobiError("this book is DRM protected")
    decompress = _build_decompressor(header, db.record)
    trailers, multibyte = _trailing_counts(header.traildata_flags)
    chunks = []
    for i in range(1, header.text_records + 1):
        chunk = _trim_trailing(db.record(i), trailers, multibyte)
        chunks.append(decompress(chunk))
    raw = b"".join(chunks)
    # 版本 8 的正文是"骨架 + 碎片"，得先拼回来
    if header.is_kf8():
        raw = _kf8_markup(db, header, raw)
    markup = raw.decode(header.codec, errors="replace")
    return _PAGE_BREAK.sub("<br/>", markup), header.codec


def _sniff_image(payload: bytes) -> Optional[str]:
    """Guess an image's media type from its magic bytes."""
    # 只认桌面壳会显示的那几种（见 library._COVER_EXTENSIONS）
    if payload[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if payload[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if payload[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if payload[:4] == b"RIFF" and payload[8:12] == b"WEBP":
        return "image/webp"
    return None


def extract_cover(source: Path) -> Optional[Tuple[bytes, str]]:
    """Return ``(image bytes, media type)`` of the book's cover, or ``None``.

    A missing cover must never fail an import, so every failure here is reported
    as ``None`` rather than raised.
    """
    try:
        db = _PalmDatabase(source.read_bytes())
        header = _MobiHeader(db.record(0))
        offset = header.exth_int(_EXTH_COVER_OFFSET)
        if offset is None:
            return None
        # 封面偏移是相对"第一条资源记录"的序号，不是绝对的
        payload = db.record(header.first_resource + offset)
    except (MobiError, OSError, struct.error):
        return None
    media_type = _sniff_image(payload)
    if media_type is None:
        return None
    return payload, media_type


def metadata(source: Path) -> Dict[str, str]:
    """Best-effort ``{'title': ..., 'author': ...}`` from the file's EXTH block.

    Only used as a fallback; the library keeps deriving names from the file name
    exactly like it does for epub.
    """
    result: Dict[str, str] = {}
    try:
        db = _PalmDatabase(source.read_bytes())
        header = _MobiHeader(db.record(0))
    except (MobiError, OSError, struct.error):
        return result
    for key, entry_type in (("title", _EXTH_TITLE), ("author", _EXTH_AUTHOR)):
        payload = header.exth.get(entry_type)
        if payload:
            result[key] = payload.decode(header.codec, errors="replace").strip()
    return result

