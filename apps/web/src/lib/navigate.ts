/** Hash navigation: navigate('/s/<id>') opens a shipment. */
export function navigate(path: string): void {
  window.location.hash = path;
}
