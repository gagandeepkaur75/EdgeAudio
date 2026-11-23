import { Link, useLocation } from "react-router-dom";
import { useSiteNavLinks, isNavActive } from "./components/siteNav";

function Home() {
  const { pathname } = useLocation();
  // Same menu items, in the same order, as the top bar on every other page.
  const links = useSiteNavLinks();

  return (
    <div className="home-page">

      {/* ================= SIDE NAVIGATION ================= */}

      <aside className="side-nav">

        <div className="side-brand">
          <Link to="/" className="side-brand-name">
            EdgeAudio<span>-QC</span>
          </Link>

          <p>
            Privacy-Preserving
            <br />
            Speech Quality
            <br />
            Estimation
          </p>
        </div>

        <nav className="side-menu">
          {links.map((link, i) => (
            <Link
              key={link.label}
              to={link.to}
              className={`side-link${isNavActive(pathname, link.to) ? " active" : ""}`}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="side-footer">
          Software Engineering
          <br />
          Project
        </div>

      </aside>


      {/* ================= MAIN HERO ================= */}

      <main className="home-main">

        <div className="hero-content">

          <div className="hero-tag">
            SOFTWARE ENGINEERING PROJECT
          </div>

          <h1>
            EdgeAudio<span>-QC</span>
          </h1>

          <h2>
            Privacy-Preserving Speech Quality Estimation
          </h2>

          <p className="hero-description">
            A browser-based system that estimates perceived
            speech quality during a live web communication
            session while keeping raw audio on the user's device.
          </p>


          {/* ================= HOME BUTTONS ================= */}

          <div className="home-actions">
            <Link to="/live-communication" className="live-home-btn">
              Start Live Communication
            </Link>

            <Link to="/project" className="primary-btn">
              Explore Project
            </Link>

            <Link to="/planning-v1" className="secondary-btn">
              Planning Presentation
            </Link>

            <Link to="/final-presentation" className="secondary-btn">
              Final Presentation
            </Link>
          </div>

        </div>

      </main>

    </div>
  );
}

export default Home;
