import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../utils/api";
import Planning from "./planning";

export default function DeliverablePage() {
  const { slug } = useParams();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  
  // Tab toggle for slugs that support interactive slideshows (like planning-v1)
  const [viewMode, setViewMode] = useState("interactive"); // "interactive" or "metadata"

  useEffect(() => {
    fetchDeliverable();
  }, [slug]);

  const fetchDeliverable = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getDeliverable(slug);
      setData(result);
      if (result) {
        // If it was fetched, check if it's planning-v1.
        // Default to interactive mode if it is planning-v1, otherwise metadata
        setViewMode(slug === "planning-v1" ? "interactive" : "metadata");
      } else {
        // Not in database. If it's planning-v1, we show the static interactive deck by default
        if (slug === "planning-v1") {
          setViewMode("interactive");
        }
      }
    } catch (err) {
      console.error(err);
      setError("An error occurred while loading this deliverable page.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="site-page">
        <nav className="inner-nav">
          <Link to="/" className="inner-logo">
            EdgeAudio<span>-QC</span>
          </Link>
          <div className="inner-nav-links">
            <Link to="/">Home</Link>
            <Link to="/project">Project</Link>
            <Link to="/team">Team</Link>
            <Link to="/timeline">Timeline</Link>
            <Link to="/architecture">Architecture</Link>
            <Link to="/admin">Admin</Link>
          </div>
        </nav>
        <main className="page-container" style={{ textAlign: "center", padding: "5rem 0" }}>
          <h2>Loading deliverable page...</h2>
          <div className="upload-icon" style={{ animation: "spin 2s linear infinite" }}>⏳</div>
        </main>
      </div>
    );
  }

  // Fallback: If not found in DB but it's planning-v1, render static deck.
  // Or, if found in DB and it's planning-v1 and viewMode is "interactive", render static deck.
  const isPlanningV1 = slug === "planning-v1";
  
  if ((!data && isPlanningV1) || (data && isPlanningV1 && viewMode === "interactive")) {
    return (
      <div style={{ position: "relative" }}>
        {/* Toggle Bar at top of screen for planning-v1 */}
        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 1000,
          background: "#07152b",
          color: "white",
          padding: "0.5rem 1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
          borderBottom: "1px solid #173b60"
        }}>
          <span style={{ fontSize: "0.9rem", fontWeight: "bold", letterSpacing: "1px" }}>
            Planning V1 Slideshow Deck
          </span>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => setViewMode("interactive")}
              style={{
                background: viewMode === "interactive" ? "#4aa7c7" : "transparent",
                color: viewMode === "interactive" ? "#07152b" : "white",
                border: viewMode === "interactive" ? "1px solid #4aa7c7" : "1px solid rgba(255, 255, 255, 0.4)",
                padding: "0.3rem 0.8rem",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: "bold",
                transition: "all 0.2s"
              }}
            >
              Interactive Slideshow
            </button>
            <button
              onClick={() => setViewMode("metadata")}
              style={{
                background: viewMode === "metadata" ? "#4aa7c7" : "transparent",
                color: viewMode === "metadata" ? "#07152b" : "white",
                border: viewMode === "metadata" ? "1px solid #4aa7c7" : "1px solid rgba(255, 255, 255, 0.4)",
                padding: "0.3rem 0.8rem",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: "bold",
                transition: "all 0.2s"
              }}
              disabled={!data}
              title={!data ? "No official presentation file published yet. Upload it in the Admin Panel to unlock details." : ""}
            >
              {data ? "File Details & Download" : "File Details (Unpublished)"}
            </button>
            <Link to="/" style={{ color: "#4aa7c7", textDecoration: "underline", marginLeft: "1rem", fontSize: "0.85rem", alignSelf: "center", fontWeight: "bold" }}>
              Back to Home
            </Link>
          </div>
        </div>
        
        {/* Render the interactive planning presentation */}
        <Planning />
      </div>
    );
  }

  // 404 Case
  if (!data) {
    return (
      <div className="site-page">
        <nav className="inner-nav">
          <Link to="/" className="inner-logo">
            EdgeAudio<span>-QC</span>
          </Link>
          <div className="inner-nav-links">
            <Link to="/">Home</Link>
            <Link to="/project">Project</Link>
            <Link to="/team">Team</Link>
            <Link to="/timeline">Timeline</Link>
            <Link to="/architecture">Architecture</Link>
            <Link to="/admin">Admin</Link>
          </div>
        </nav>
        <main className="page-container" style={{ textAlign: "center", padding: "5rem 2rem" }}>
          <div className="upload-icon" style={{ fontSize: "4rem", marginBottom: "1.5rem" }}>⚠️</div>
          <h1>Deliverable Page Not Found</h1>
          <p style={{ maxWidth: "600px", margin: "1rem auto 2rem auto", fontSize: "1.1rem" }}>
            The requested version page <strong>"{slug}"</strong> has not been published yet or the link is incorrect. If you are an instructor or teammate, you can publish it via the Admin Panel.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
            <Link to="/" className="navy-button">Go to Homepage</Link>
            <Link to="/admin" className="outline-button">Go to Admin Login</Link>
          </div>
        </main>
      </div>
    );
  }

  // Parse file types and URLs for the embedded preview
  const ext = data?.original_filename?.split(".").pop()?.toLowerCase() || "";
  const isPdf = ext === "pdf";
  const isOffice = ["pptx", "ppt", "docx", "xlsx"].includes(ext);
  const isLocal = data?.file_url?.includes("localhost") || data?.file_url?.includes("127.0.0.1");

  const renderPreview = () => {
    if (isPdf) {
      return (
        <section className="project-section" style={{ marginTop: "2rem" }}>
          <h2>Document Preview</h2>
          <div style={{ border: "1px solid rgba(0,0,0,0.15)", borderRadius: "6px", overflow: "hidden", background: "#f9fafb" }}>
            <iframe src={data.file_url} width="100%" height="600px" style={{ border: "none", display: "block" }} title="PDF Document Preview" />
          </div>
        </section>
      );
    }
    
    if (isOffice) {
      if (isLocal) {
        return (
          <section className="project-section" style={{ marginTop: "2rem" }}>
            <h2>Presentation Preview</h2>
            <div className="blue-box" style={{ padding: "2.5rem", textAlign: "center" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>ℹ</div>
              <h3>Embedded Slide Preview</h3>
              <p style={{ margin: "0.5rem 0 0 0", color: "#475569" }}>
                Office slide previews are generated via Microsoft Office Online and require a public deployment URL.
                <br />
                Preview will become live automatically once deployed to production (AWS S3/Cloudflare R2).
              </p>
            </div>
          </section>
        );
      }
      
      const embedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(data.file_url)}`;
      return (
        <section className="project-section" style={{ marginTop: "2rem" }}>
          <h2>Presentation Slide Preview</h2>
          <div style={{ border: "1px solid rgba(0,0,0,0.15)", borderRadius: "6px", overflow: "hidden", background: "#f9fafb" }}>
            <iframe src={embedUrl} width="100%" height="600px" style={{ border: "none", display: "block" }} title="Office Presentation Preview" />
          </div>
        </section>
      );
    }
    
    return null;
  };

  // Dynamic Metadata and File Download View
  return (
    <div className="site-page">
      <nav className="inner-nav">
        <Link to="/" className="inner-logo">
          EdgeAudio<span>-QC</span>
        </Link>
        <div className="inner-nav-links">
          <Link to="/">Home</Link>
          <Link to="/project">Project</Link>
          <Link to="/team">Team</Link>
          <Link to="/timeline">Timeline</Link>
          <Link to="/architecture">Architecture</Link>
          <Link to="/admin">Admin</Link>
        </div>
      </nav>
      
      <main className="page-container">
        {/* Switch back button for planning-v1 */}
        {isPlanningV1 && (
          <div style={{ marginBottom: "1rem" }}>
            <button
              onClick={() => setViewMode("interactive")}
              className="outline-button"
              style={{ padding: "0.4rem 1rem", fontSize: "0.9rem" }}
            >
              ← Back to Interactive Slideshow
            </button>
          </div>
        )}

        <div className="page-title">
          <span>{data.deliverable_type.toUpperCase()} DELIVERABLE</span>
          <h1>{data.title}</h1>
          <p>
            Version {data.version} — Published on {new Date(data.presentation_date).toLocaleDateString()}
          </p>
        </div>

        {/* Deliverable Metadata Banner */}
        <div className="version-banner" style={{ margin: "2rem 0" }}>
          <div><strong>Version:</strong> {data.version}</div>
          <div><strong>Presentation Date:</strong> {new Date(data.presentation_date).toLocaleDateString()}</div>
          <div><strong>Authors:</strong> {data.authors}</div>
        </div>

        {/* Change Summary */}
        <section className="project-section">
          <h2>Change Summary / Version Description</h2>
          <div className="blue-box" style={{ whiteSpace: "pre-wrap" }}>
            <p>{data.change_summary || "No description provided."}</p>
          </div>
        </section>

        {/* Embedded Slide/Document Preview Panel */}
        {renderPreview()}

        {/* PowerPoint / PDF File Action Container */}
        <section className="project-section" style={{ marginTop: "2rem" }}>
          <div className="admin-login" style={{ padding: "2.5rem", textAlign: "center", border: "1px solid rgba(0,0,0,0.1)", borderRadius: "6px" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📦</div>
            <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
              {data.original_filename || "Presentation Attachment"}
            </h2>
            <p style={{ color: "#666", marginBottom: "1.5rem" }}>
              Type: {data.original_filename?.split(".").pop()?.toUpperCase() || "Unknown"} 
              {data.file_size_bytes ? ` • Size: ${(data.file_size_bytes / (1024 * 1024)).toFixed(2)} MB` : ""}
            </p>
            
            <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
              <a
                href={data.file_url}
                download={data.original_filename || `${slug}-file`}
                className="navy-button"
                style={{ textDecoration: "none", display: "inline-block" }}
              >
                Download Presentation File
              </a>
              
              <a
                href={data.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="outline-button"
                style={{ textDecoration: "none", display: "inline-block" }}
              >
                Open in Browser
              </a>
            </div>
          </div>
        </section>

        {/* Audit Details */}
        <p style={{ fontSize: "0.85rem", color: "#888", textAlign: "center", marginTop: "3rem" }}>
          This page represents a permanent historical artifact published on {new Date(data.published_at).toLocaleString()}.
          It cannot be deleted or overwritten, ensuring a complete engineering audit trail.
        </p>
      </main>
    </div>
  );
}
