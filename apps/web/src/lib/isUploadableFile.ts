/** What the upload takes: PDFs, phone photos and spreadsheets. Browsers do not always set the type of a dropped file, so the extension counts too. */
const EXTENSIONS = /\.(pdf|jpe?g|png|heic|heif|xlsx|xlsm|csv)$/i;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

/** The file chooser's accept list. */
export const UPLOAD_ACCEPT = [...TYPES, '.pdf', '.jpg', '.jpeg', '.png', '.heic', '.heif', '.xlsx', '.xlsm', '.csv'].join(',');

export function isUploadableFile(file: File): boolean {
  return TYPES.includes(file.type) || EXTENSIONS.test(file.name);
}
