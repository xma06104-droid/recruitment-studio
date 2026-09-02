import { stripResumeHtml } from '@/app/server/resume-parser';
import { extractText } from 'unpdf';

export type ResumeFileExtraction = {
  text: string;
  status: 'extracted' | 'unsupported' | 'failed';
  message: string;
};

const textExtensions = ['txt', 'html', 'htm'];
const MAX_EXTRACTED_TEXT = 120_000;
const MAX_PDF_STREAMS = 600;

export async function extractResumeFileText(file: File): Promise<ResumeFileExtraction> {
  const ext = extension(file.name);
  try {
    if (textExtensions.includes(ext)) {
      const source = await file.text();
      const text = ext.startsWith('htm') ? stripResumeHtml(source) : source;
      return text.trim() ? extracted(text) : failed('文件中没有可识别的文本内容。');
    }
    if (ext === 'docx') {
      const text = await extractDocxText(await file.arrayBuffer());
      return text.trim() ? extracted(text) : failed('Word 简历中未提取到有效文字，请确认文件未加密或未损坏。');
    }
    if (ext === 'pdf') {
      const text = await extractPdfText(await file.arrayBuffer());
      return text.trim() ? extracted(text) : failed('PDF 中未提取到可复制文字；如果是扫描件，请粘贴 OCR 文本后继续。');
    }
    if (ext === 'doc') return unsupported('旧版 .doc 暂不支持直接解析，请另存为 .docx 或 PDF 后重新上传。');
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return unsupported('图片简历需要 OCR 文字识别，请粘贴 OCR 文本后自动回填。');
    return unsupported('该文件格式暂不支持自动提取文字。');
  } catch {
    return failed('简历文件解析失败，请确认文件未加密、未损坏，并重新上传。');
  }
}

async function extractDocxText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const end = findSignature(view, 0x06054b50, Math.max(0, bytes.length - 65_557), bytes.length - 4);
  if (end < 0) throw new Error('DOCX central directory not found');
  const entryCount = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount && offset + 46 <= bytes.length; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name === 'word/document.xml') {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('DOCX local entry not found');
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      const xmlBytes = method === 0 ? compressed : method === 8 ? await decompress(compressed, 'deflate-raw') : null;
      if (!xmlBytes) throw new Error('Unsupported DOCX compression');
      return wordXmlToText(decoder.decode(xmlBytes));
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('DOCX document.xml not found');
}

async function extractPdfText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  try {
    const result = await extractText(bytes, { mergePages: true });
    const text = String(result.text || '').trim();
    if (isUsefulPdfText(text)) return text.slice(0, MAX_EXTRACTED_TEXT);
  } catch {}
  return extractPdfTextFallback(buffer);
}

async function extractPdfTextFallback(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const source = latin1(bytes);
  const streams: string[] = [];
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(source)) && streams.length < MAX_PDF_STREAMS) {
    const start = match.index + match[0].length;
    const end = source.indexOf('endstream', start);
    if (end < 0) break;
    const header = source.slice(Math.max(0, match.index - 360), match.index);
    if (/\/FlateDecode/.test(header)) {
      try {
        const inflated = await decompress(bytes.slice(start, trimPdfStreamEnd(bytes, start, end)), 'deflate');
        streams.push(latin1(inflated));
      } catch {}
    }
    streamPattern.lastIndex = end + 9;
  }

  const cmap = buildPdfUnicodeMap(streams);
  const lines: string[] = [];
  for (const stream of streams) {
    const blocks = stream.match(/BT[\s\S]*?ET/g) || [];
    for (const block of blocks) {
      const values = block.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g) || [];
      const line = values.map(value => value.startsWith('(') ? decodePdfLiteral(value.slice(1, -1)) : decodePdfHex(value.slice(1, -1), cmap)).join(' ').replace(/\s+/g, ' ').trim();
      if (line && /[A-Za-z0-9\u4e00-\u9fa5]/.test(line)) lines.push(line);
    }
  }
  return [...new Set(lines)].join('\n').slice(0, MAX_EXTRACTED_TEXT);
}

function isUsefulPdfText(value: string) {
  const meaningful = value.match(/[A-Za-z0-9\u4e00-\u9fa5]/g)?.length || 0;
  return meaningful >= 12 && meaningful / Math.max(value.length, 1) >= 0.18;
}

function buildPdfUnicodeMap(streams: string[]) {
  const map = new Map<string, string>();
  for (const stream of streams) {
    const pairs = stream.matchAll(/<([0-9A-Fa-f]{2,8})>\s*<([0-9A-Fa-f]{4,})>/g);
    for (const pair of pairs) map.set(pair[1].toUpperCase(), decodeUtf16Hex(pair[2]));
    const ranges = stream.matchAll(/<([0-9A-Fa-f]{2,8})>\s*<([0-9A-Fa-f]{2,8})>\s*<([0-9A-Fa-f]{4,})>/g);
    for (const range of ranges) {
      const from = Number.parseInt(range[1], 16); const to = Number.parseInt(range[2], 16); const target = Number.parseInt(range[3], 16);
      if (Number.isFinite(from) && Number.isFinite(to) && to - from < 512) {
        const width = range[1].length;
        for (let code = from; code <= to; code += 1) map.set(code.toString(16).toUpperCase().padStart(width, '0'), String.fromCodePoint(target + code - from));
      }
    }
  }
  return map;
}

function decodePdfHex(value: string, cmap: Map<string, string>) {
  const hex = value.replace(/\s/g, '').toUpperCase();
  if (hex.startsWith('FEFF')) return decodeUtf16Hex(hex.slice(4));
  for (const width of [4, 2, 6, 8]) {
    if (hex.length % width !== 0) continue;
    const chunks = hex.match(new RegExp(`.{${width}}`, 'g')) || [];
    if (chunks.length && chunks.every(chunk => cmap.has(chunk))) return chunks.map(chunk => cmap.get(chunk)).join('');
  }
  const bytes = hexToBytes(hex);
  return printableText(latin1(bytes));
}

function decodePdfLiteral(value: string) {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code !== 92) { bytes.push(code & 255); continue; }
    const next = value[index + 1];
    if (/[0-7]/.test(next || '')) {
      const octal = value.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] || '';
      bytes.push(Number.parseInt(octal, 8)); index += octal.length; continue;
    }
    const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
    if (next in escapes) { bytes.push(escapes[next]); index += 1; }
  }
  const data = new Uint8Array(bytes);
  if (data[0] === 0xfe && data[1] === 0xff) return decodeUtf16Bytes(data.slice(2));
  return printableText(latin1(data));
}

function wordXmlToText(xml: string) {
  return decodeXml(xml.replace(/<w:tab\s*\/>/g, '\t').replace(/<w:(?:br|cr)\s*\/>/g, '\n').replace(/<\/w:(?:p|tr)>/g, '\n').replace(/<w:tc[^>]*>/g, ' ').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

async function decompress(bytes: Uint8Array, format: 'deflate' | 'deflate-raw') {
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findSignature(view: DataView, signature: number, start: number, end: number) {
  for (let offset = end; offset >= start; offset -= 1) if (view.getUint32(offset, true) === signature) return offset;
  return -1;
}

function trimPdfStreamEnd(bytes: Uint8Array, start: number, end: number) {
  let result = end;
  while (result > start && (bytes[result - 1] === 10 || bytes[result - 1] === 13)) result -= 1;
  return result;
}

function latin1(bytes: Uint8Array) { return new TextDecoder('latin1').decode(bytes); }
function hexToBytes(value: string) { const even = value.length % 2 ? `${value}0` : value; return new Uint8Array((even.match(/../g) || []).map(item => Number.parseInt(item, 16))); }
function decodeUtf16Hex(value: string) { return decodeUtf16Bytes(hexToBytes(value)); }
function decodeUtf16Bytes(bytes: Uint8Array) { let result = ''; for (let index = 0; index + 1 < bytes.length; index += 2) result += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]); return result; }
function printableText(value: string) { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim(); }
function extension(name: string) { return name.split('.').pop()?.toLowerCase() || ''; }
function extracted(text: string): ResumeFileExtraction { return { text: text.slice(0, MAX_EXTRACTED_TEXT), status: 'extracted', message: '已扫描全部可识别页面并提取简历文字。' }; }
function unsupported(message: string): ResumeFileExtraction { return { text: '', status: 'unsupported', message }; }
function failed(message: string): ResumeFileExtraction { return { text: '', status: 'failed', message }; }
