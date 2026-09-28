import { Link } from "react-router";
import { Page } from "../../ui/components";

export function NotFoundPage() {
  return (
    <Page title="Esta página no existe" narrow>
      <p>
        Puede que el link esté mal o que la página se haya movido. <Link to="/">Volver al inicio</Link>.
      </p>
    </Page>
  );
}
