import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPdf, isPdfFile, pageForLine } from '../src/loaders/pdf.js';

// A minimal valid two-page PDF generated offline. Page 1: "Hello PDF World".
// Page 2: "Page two text".
const PDF_BASE64 =
  'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9Db3VudCAyIC9LaWRzIFszIDAgUiA1IDAgUl0gPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSAxIDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NyA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDEwMCA3MDAgVGQgKEhlbGxvIFBERiBXb3JsZCkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9QYWdlIC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFswIDAgNjEyIDc5Ml0gL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgMSAwIFIgPj4gPj4gL0NvbnRlbnRzIDYgMCBSID4+CmVuZG9iago2IDAgb2JqCjw8IC9MZW5ndGggNDUgPj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiAxMDAgNzAwIFRkIChQYWdlIHR3byB0ZXh0KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjcgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+CmVuZG9iagp4cmVmCjAgOAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA4NSAwMDAwMCBuIAowMDAwMDAwMTQ4IDAwMDAwIG4gCjAwMDAwMDAyNzQgMDAwMDAgbiAKMDAwMDAwMDM3MSAwMDAwMCBuIAowMDAwMDAwNDk3IDAwMDAwIG4gCjAwMDAwMDA1OTIgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA4IC9Sb290IDcgMCBSID4+CnN0YXJ0eHJlZgo2NDEKJSVFT0YK';

describe('pdf loader', () => {
  let dir: string;
  let pdfPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cm-pdf-'));
    pdfPath = join(dir, 'sample.pdf');
    await writeFile(pdfPath, Buffer.from(PDF_BASE64, 'base64'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('isPdfFile recognises .pdf paths', () => {
    expect(isPdfFile('foo.pdf')).toBe(true);
    expect(isPdfFile('foo.PDF')).toBe(true);
    expect(isPdfFile('foo.md')).toBe(false);
  });

  it('extracts page text and exposes page count and offsets', async () => {
    const { doc, body, pageCount, pageOffsets } = await loadPdf(pdfPath);
    expect(pageCount).toBe(2);
    expect(pageOffsets).toHaveLength(2);
    expect(pageOffsets[0]).toBe(0);
    expect(pageOffsets[1]).toBeGreaterThan(0);
    expect(body).toContain('Hello PDF World');
    expect(body).toContain('Page two text');
    expect(body).toContain('\f');
    expect(doc.language).toBe('pdf');
    expect(doc.title).toBe('sample');
    expect(doc.hash).toBeTruthy();
    expect(doc.size).toBeGreaterThan(0);
  });

  it('pageForLine maps body lines to 1-based page numbers', async () => {
    const { body, pageOffsets } = await loadPdf(pdfPath);
    expect(pageForLine(body, pageOffsets, 1)).toBe(1);
    // Last line of body lives on page 2.
    const totalLines = body.split('\n').length;
    expect(pageForLine(body, pageOffsets, totalLines)).toBe(2);
  });
});
