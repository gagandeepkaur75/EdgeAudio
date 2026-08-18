import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api, auth } from "../utils/api";
import PageNav from "../components/PageNav";

export default function AdminPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(auth.isLoggedIn());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  // Upload state
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccessData, setUploadSuccessData] = useState(null); // { fileKey, fileUrl, originalFilename, sizeBytes }

  // Form state
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [deliverableType, setDeliverableType] = useState("planning");
  const [version, setVersion] = useState("v1");
  const [presentationDate, setPresentationDate] = useState(new Date().toISOString().split("T")[0]);
  const [authors, setAuthors] = useState("Gagandeep, Prabhleen, Dishita");
  const [changeSummary, setChangeSummary] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState({ success: false, error: "", link: "" });

  // List of deliverables
  const [deliverables, setDeliverables] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isLoggedIn) {
      fetchHistory();
    }

    // Listen for global 401 unauth events
    const handleUnauth = () => {
      setIsLoggedIn(false);
      setLoginError("Session expired. Please log in again.");
    };
    window.addEventListener("api-unauthorized", handleUnauth);
    return () => window.removeEventListener("api-unauthorized", handleUnauth);
  }, [isLoggedIn]);

  const fetchHistory = async () => {
    try {
      const data = await api.getDeliverables();
      setDeliverables(data);
    } catch (err) {
      console.error("Failed to load deliverables history", err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      await api.login(username, password);
      setIsLoggedIn(true);
      setLoginError("");
    } catch (err) {
      setLoginError(err.message || "Invalid credentials");
    }
  };

  const handleLogout = () => {
    auth.clearToken();
    setIsLoggedIn(false);
    // Reset state
    setFile(null);
    setUploadSuccessData(null);
    setPublishStatus({ success: false, error: "", link: "" });
  };

  // Drag and Drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      await uploadFile(droppedFiles[0]);
    }
  };

  const handleFileSelect = async (e) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      await uploadFile(selectedFiles[0]);
    }
  };

  const uploadFile = async (selectedFile) => {
    setFile(selectedFile);
    setUploading(true);
    setUploadError("");
    setUploadSuccessData(null);
    setPublishStatus({ success: false, error: "", link: "" });
    
    try {
      const res = await api.upload(selectedFile);
      setUploadSuccessData(res);
      
      // Auto-suggest metadata values from file name
      const nameWithoutExt = selectedFile.name.substring(0, selectedFile.name.lastIndexOf("."));
      setTitle(nameWithoutExt.replace(/[-_]+/g, " "));
      
      // Try to extract version e.g. v1, v2
      const versionMatch = nameWithoutExt.match(/v\d+/i);
      if (versionMatch) {
        setVersion(versionMatch[0].toLowerCase());
      }
      
      // Suggest slug
      const suggestedSlug = nameWithoutExt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      setSlug(suggestedSlug);
    } catch (err) {
      setUploadError(err.message || "Failed to upload file");
      setFile(null);
    } finally {
      setUploading(false);
    }
  };

  // Keep slug updated when title changes, unless user edited slug manually
  const [userEditedSlug, setUserEditedSlug] = useState(false);
  const handleTitleChange = (e) => {
    const val = e.target.value;
    setTitle(val);
    if (!userEditedSlug) {
      const suggestedSlug = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      setSlug(suggestedSlug);
    }
  };

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!uploadSuccessData) {
      setPublishStatus({ success: false, error: "Please upload a file first", link: "" });
      return;
    }

    setIsPublishing(true);
    setPublishStatus({ success: false, error: "", link: "" });

    const payload = {
      slug,
      title,
      deliverableType,
      version,
      presentationDate,
      authors,
      changeSummary,
      fileKey: uploadSuccessData.fileKey,
      fileUrl: uploadSuccessData.fileUrl,
      originalFilename: uploadSuccessData.originalFilename,
      sizeBytes: uploadSuccessData.sizeBytes,
    };

    try {
      await api.publish(payload);
      setPublishStatus({
        success: true,
        error: "",
        link: `/${slug}`,
      });
      // Refresh list
      fetchHistory();
      // Reset upload state
      setFile(null);
      setUploadSuccessData(null);
      setTitle("");
      setSlug("");
      setChangeSummary("");
      setUserEditedSlug(false);
    } catch (err) {
      if (err.status === 409) {
        setPublishStatus({
          success: false,
          error: `Error: The slug "${slug}" already exists. Please choose a different version slug (e.g. ${slug}-v2) to preserve history.`,
          link: "",
        });
      } else {
        setPublishStatus({
          success: false,
          error: err.message || "Failed to publish deliverable.",
          link: "",
        });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="site-page">
        <PageNav />
        <main className="page-container">
          <div className="page-title">
            <span>ADMINISTRATION</span>
            <h1>Instructor / Admin Interface</h1>
            <p>Access the administrative panel to upload and publish official project deliverables.</p>
          </div>

          <section className="project-section">
            <div className="admin-login" style={{ maxWidth: "450px", margin: "0 auto" }}>
              <h2>Admin Sign In</h2>
              {loginError && <div className="alert-error" style={{ marginBottom: "1rem" }}>{loginError}</div>}
              <form onSubmit={handleLogin}>
                <label>Username</label>
                <input
                  type="text"
                  placeholder="Admin username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
                <label>Password</label>
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button className="navy-button" type="submit" style={{ marginTop: "1rem", width: "100%" }}>
                  Sign In
                </button>
              </form>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="site-page">
      <PageNav />
      <main className="page-container">
        <div className="page-title">
          <span>ADMIN DASHBOARD</span>
          <h1>Admin Portal</h1>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <p>Welcome back! You are logged in as admin.</p>
            <button className="outline-button" onClick={handleLogout} style={{ padding: "0.4rem 1rem", fontSize: "0.9rem" }}>
              Sign Out
            </button>
          </div>
        </div>

        {/* DRAG AND DROP ZONE */}
        <section className="project-section">
          <h2>1. Upload Presentation File</h2>
          <div
            className={`upload-box ${isDragging ? "dragging" : ""} ${uploadSuccessData ? "success" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{ cursor: "pointer", transition: "all 0.2s" }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />
            <div className="upload-icon">
              {uploading ? "⏳" : uploadSuccessData ? "✓" : "↑"}
            </div>
            
            {uploading ? (
              <>
                <h3>Uploading to storage...</h3>
                <p>Streaming chunks to object storage. Please wait.</p>
              </>
            ) : uploadSuccessData ? (
              <>
                <h3 style={{ color: "#4caf50" }}>File Uploaded Successfully!</h3>
                <p style={{ fontWeight: "bold" }}>{uploadSuccessData.originalFilename}</p>
                <p>Size: {(uploadSuccessData.sizeBytes / (1024 * 1024)).toFixed(2)} MB</p>
                <span className="outline-button" style={{ marginTop: "1rem", pointerEvents: "none" }}>Change File</span>
              </>
            ) : (
              <>
                <h3>Drag & Drop File</h3>
                <p>Drop presentation files, PDFs, images or folders here.</p>
                <button className="outline-button" type="button" style={{ pointerEvents: "none" }}>
                  Browse Files
                </button>
              </>
            )}
          </div>
          {uploadError && <div className="alert-error" style={{ marginTop: "1rem" }}>{uploadError}</div>}
        </section>

        {/* PUBLICATION FORM */}
        <section className="project-section" style={{ opacity: uploadSuccessData ? 1 : 0.6, pointerEvents: uploadSuccessData ? "auto" : "none" }}>
          <h2>2. Publication Information</h2>
          {!uploadSuccessData && (
            <div className="alert-info" style={{ marginBottom: "1rem" }}>
              ℹ Please upload a file above to unlock the publication form.
            </div>
          )}
          
          {publishStatus.error && (
            <div className="alert-error" style={{ marginBottom: "1.5rem" }}>
              {publishStatus.error}
            </div>
          )}

          {publishStatus.success && (
            <div className="alert-success" style={{ marginBottom: "1.5rem" }}>
              🎉 <strong>Successfully Published!</strong> Your deliverable is now live.
              <br />
              <Link to={publishStatus.link} className="alert-link" style={{ fontWeight: "bold", textDecoration: "underline", color: "#1e3a8a" }}>
                View Published Page: {window.location.origin}{publishStatus.link}
              </Link>
            </div>
          )}

          <form onSubmit={handlePublish}>
            <div className="form-grid">
              <div>
                <label>Title</label>
                <input
                  placeholder="Presentation title"
                  value={title}
                  onChange={handleTitleChange}
                  required
                  disabled={!uploadSuccessData}
                />
              </div>
              <div>
                <label>Unique URL Slug</label>
                <input
                  placeholder="e.g. planning-v1"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"));
                    setUserEditedSlug(true);
                  }}
                  required
                  disabled={!uploadSuccessData}
                />
              </div>
              <div>
                <label>Deliverable Type</label>
                <select
                  value={deliverableType}
                  onChange={(e) => setDeliverableType(e.target.value)}
                  disabled={!uploadSuccessData}
                  style={{
                    width: "100%",
                    padding: "0.8rem",
                    border: "1px solid rgba(0, 0, 0, 0.15)",
                    borderRadius: "4px",
                    backgroundColor: "white",
                    fontSize: "1rem"
                  }}
                >
                  <option value="planning">Planning Presentation</option>
                  <option value="midsem">Midsem Presentation</option>
                  <option value="final-demo">Final Demo</option>
                  <option value="other">Other Deliverable</option>
                </select>
              </div>
              <div>
                <label>Presentation Version</label>
                <input
                  placeholder="e.g. v1, v2"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  required
                  disabled={!uploadSuccessData}
                />
              </div>
              <div>
                <label>Presentation Date</label>
                <input
                  type="date"
                  value={presentationDate}
                  onChange={(e) => setPresentationDate(e.target.value)}
                  required
                  disabled={!uploadSuccessData}
                />
              </div>
              <div>
                <label>Authors</label>
                <input
                  placeholder="Comma-separated names"
                  value={authors}
                  onChange={(e) => setAuthors(e.target.value)}
                  required
                  disabled={!uploadSuccessData}
                />
              </div>
              <div className="full-width">
                <label>Change Summary</label>
                <textarea
                  placeholder="Describe changes made in this version (required for audit trail)"
                  value={changeSummary}
                  onChange={(e) => setChangeSummary(e.target.value)}
                  required
                  disabled={!uploadSuccessData}
                  rows={4}
                />
              </div>
            </div>
            <button
              className="navy-button"
              type="submit"
              disabled={isPublishing || !uploadSuccessData}
              style={{ marginTop: "1rem" }}
            >
              {isPublishing ? "Publishing..." : "Publish Deliverable"}
            </button>
          </form>
        </section>

        {/* VERSION AUDIT HISTORY */}
        <section className="project-section">
          <h2>Published Deliverables Audit History</h2>
          <p style={{ marginBottom: "1rem" }}>
            The list below displays all published deliverables. Old versions are never overwritten or deleted to maintain a clear audit trail.
          </p>
          
          {deliverables.length === 0 ? (
            <div className="blue-box" style={{ textAlign: "center" }}>
              No deliverables have been published yet.
            </div>
          ) : (
            <div className="version-list">
              {deliverables.map((d) => (
                <Link to={`/${d.slug}`} className="version-item" key={d.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <div>
                      <strong>{d.title}</strong>
                      <span style={{ fontSize: "0.85rem", color: "#666", display: "block" }}>
                        Type: {d.deliverable_type} • Version: {d.version} • Published: {new Date(d.published_at).toLocaleDateString()}
                      </span>
                    </div>
                    <span className="outline-button" style={{ fontSize: "0.8rem", padding: "0.2rem 0.6rem" }}>
                      View Page
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
