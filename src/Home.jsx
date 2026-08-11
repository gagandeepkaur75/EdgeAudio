import { Link } from "react-router-dom";

function Home() {
  return (
    <div className="home-page">

      {/* ================= SIDE NAVIGATION ================= */}

      <aside className="side-nav">

        <div className="side-brand">
          <div className="side-brand-name">
            EdgeAudio<span>-QC</span>
          </div>

          <p>
            Privacy-Preserving
            <br />
            Speech Quality
            <br />
            Estimation
          </p>
        </div>

        <nav className="side-menu">

          <Link to="/" className="side-link active">
            <span>01</span>
            Home
          </Link>

          <Link to="/project" className="side-link">
            <span>02</span>
            Project
          </Link>

          <Link to="/team" className="side-link">
            <span>03</span>
            Team
          </Link>

          <Link to="/planning-v1" className="side-link">
            <span>04</span>
            Planning V1
          </Link>

          <Link to="/planning-v2" className="side-link">
            <span>05</span>
            Planning V2
          </Link>

          <Link to="/timeline" className="side-link">
            <span>06</span>
            Timeline
          </Link>

          <Link to="/architecture" className="side-link">
            <span>07</span>
            Architecture
          </Link>

          <Link to="/admin" className="side-link">
            <span>08</span>
            Admin
          </Link>

        </nav>

        <div className="side-footer">
          UCS503
          <br />
          Software Project
        </div>

      </aside>


      {/* ================= MAIN HERO ================= */}

      <main className="home-main">

        <div className="hero-content">

          <div className="hero-tag">
            UCS503 SOFTWARE PROJECT
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

            <Link
              to="/project"
              className="primary-btn"
            >
              Explore Project
            </Link>

            <Link
              to="/planning-v1"
              className="secondary-btn"
            >
              Planning Presentation V1
            </Link>

            <Link
              to="/admin"
              className="secondary-btn admin-btn"
            >
              Admin Login
            </Link>

          </div>

        </div>

      </main>

    </div>
  );
}

export default Home;