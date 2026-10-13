import { DataPage } from './DataPage';
import { PartiesPanel } from './PartiesPanel';

export function CompaniesPage() {
  return (
    <DataPage titleKey="insights.pages.companies.title" descriptionKey="insights.pages.companies.description">
      {(destination) => <PartiesPanel destination={destination} onOpen={(id) => (window.location.hash = `#/app/companies/${id}`)} />}
    </DataPage>
  );
}
