import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../utils/api";

function PageNav() {
  const [deliverables, setDeliverables] = useState([]);
  const location = useLocation();

  useEffect(() => {
    let active = true;
    api.getDeliverables()
      .then((data) => {
        if (active) setDeliverables(data);
      })
      .catch((err) => {
        console.error("Failed to load deliverables in navbar:", err);
      });
    return () => {
      active = false;
    };
  }, []);

  const latestDeliverable = deliverables.length > 0 ? deliverables[deliverables.length - 1] : null;
  const latestLink = latestDeliverable ? `/${latestDeliverable.slug}` : "/planning-v1";
  
  // Helper to determine if a link is active
  const isActive = (path) => {
    if (path === "/") {
      return location.pathname === "/" ? "active" : "";
    }
    return location.pathname.startsWith(path) ? "active" : "";
  };

  return (
    <nav className="inner-nav">
      <Link to="/" className="inner-logo">
        EdgeAudio<span>-QC</span>
      </Link>

      <div className="inner-nav-links">
        <Link to="/" className={isActive("/")}>Home</Link>
        <Link to="/project" className={isActive("/project")}>Project</Link>
        <Link to="/team" className={isActive("/team")}>Team</Link>
        <Link to="/deliverables" className={isActive("/deliverables")}>Deliverables</Link>
        <Link to={latestLink} className={isActive(latestLink)}>Latest Presentation</Link>
        <Link to="/live-communication" className={isActive("/live-communication")}>Live Test</Link>
        <Link to="/timeline" className={isActive("/timeline")}>Timeline</Link>
        <Link to="/architecture" className={isActive("/architecture")}>Architecture</Link>
        <Link to="/admin" className={isActive("/admin")}>Admin</Link>
      </div>
    </nav>
  );
}

export default PageNav;
