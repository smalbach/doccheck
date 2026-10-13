/** Hash navigation: navigate('/app/s/<id>') opens a shipment. */
export function navigate(path: string): void {
  window.location.hash = path;
}
