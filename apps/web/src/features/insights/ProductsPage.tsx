import { DataPage } from './DataPage';
import { ProductsPanel } from './ProductsPanel';

export function ProductsPage() {
  return (
    <DataPage titleKey="insights.pages.products.title" descriptionKey="insights.pages.products.description">
      {(destination) => <ProductsPanel destination={destination} onOpen={(id) => (window.location.hash = `#/app/products/${id}`)} />}
    </DataPage>
  );
}
