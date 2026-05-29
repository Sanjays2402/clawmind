import * as arrow from 'apache-arrow';

export function chunkSchema(dim: number): arrow.Schema {
  return new arrow.Schema([
    new arrow.Field('id', new arrow.Utf8(), false),
    new arrow.Field('documentId', new arrow.Utf8(), false),
    new arrow.Field('path', new arrow.Utf8(), false),
    new arrow.Field('namespace', new arrow.Utf8(), false),
    new arrow.Field('text', new arrow.Utf8(), false),
    new arrow.Field('startLine', new arrow.Int32(), false),
    new arrow.Field('endLine', new arrow.Int32(), false),
    new arrow.Field('tokens', new arrow.Int32(), false),
    new arrow.Field('ord', new arrow.Int32(), false),
    new arrow.Field(
      'embedding',
      new arrow.FixedSizeList(dim, new arrow.Field('item', new arrow.Float32(), true)),
      false,
    ),
  ]);
}

export const CHUNK_TABLE = 'chunks';
export const DOCUMENT_TABLE = 'documents';
