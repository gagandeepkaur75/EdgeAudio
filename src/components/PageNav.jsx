import { Link, useLocation } from "react-router-dom";
import { useSiteNavLinks, isNavActive } from "./siteNav";

function PageNav() {
  const { pathname } = useLocation();
  const links = useSiteNavLinks();

  return (
    <nav className="inner-nav">
      <Link to="/" className="inner-logo">
        EdgeAudio<span>-QC</span>
      </Link>

      <div className="inner-nav-links">
        {links.map((link) => (
          <Link key={link.label} to={link.to} className={isNavActive(pathname, link.to) ? "active" : ""}>
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export default PageNav;
