/** A leads upload is small by design: 500 rows of four short columns fit well under this. */
export const MAX_CSV_BODY_BYTES = 256 * 1024;

/** The multipart field names accepted: a file (`file`) or the CSV as text (`csv`). */
const FILE_FIELD = "file";
const TEXT_FIELD = "csv";

/** The request body cannot be read as a CSV upload; `status` is the HTTP status to answer with. */
export class CsvBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "CsvBodyError";
  }
}

const tooLarge = (): CsvBodyError => new CsvBodyError(`The upload must be at most ${MAX_CSV_BODY_BYTES / 1024} KB`, 413);

const sized = (text: string): string => {
  if (new TextEncoder().encode(text).length > MAX_CSV_BODY_BYTES) throw tooLarge();
  return text;
};

async function fromMultipart(request: Request): Promise<string> {
  const form = await request.formData();
  const file = form.get(FILE_FIELD);
  if (file instanceof Blob) {
    if (file.size > MAX_CSV_BODY_BYTES) throw tooLarge();
    return sized(await file.text());
  }
  const text = form.get(TEXT_FIELD);
  if (typeof text === "string") return sized(text);
  throw new CsvBodyError(`Send the CSV as the "${FILE_FIELD}" file field or the "${TEXT_FIELD}" text field`, 400);
}

/**
 * The CSV text of an import request: a multipart form (`file` or `csv`) or a
 * plain text body. Refuses anything over 256 KB, by the declared length first
 * and by the bytes actually read second.
 */
export async function readCsvBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_CSV_BODY_BYTES) throw tooLarge();
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) return fromMultipart(request);
  return sized(await request.text());
}
