const getApiUrl = () => {
  const url = import.meta.env.VITE_API_URL;
  if (!url) {
    console.warn("VITE_API_URL is not defined in the environment. Defaulting to http://localhost:3000");
    return "http://localhost:3000";
  }
  return url.replace(/\/$/, "");
};

export const API_BASE_URL = getApiUrl();

export const auth = {
  getToken: () => sessionStorage.getItem("admin_token"),
  setToken: (token) => sessionStorage.setItem("admin_token", token),
  clearToken: () => sessionStorage.removeItem("admin_token"),
  isLoggedIn: () => !!sessionStorage.getItem("admin_token"),
};

/**
 * Custom fetch wrapper that adds Auth headers and handles 401 errors.
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Set headers
  const headers = { ...options.headers };
  const token = auth.getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    auth.clearToken();
    // Fire a custom event so the App component can catch it and redirect
    window.dispatchEvent(new Event("api-unauthorized"));
    throw new Error("Unauthorized");
  }

  return response;
}

export const api = {
  /**
   * Log in as admin
   */
  async login(username, password) {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Login failed");
    }

    auth.setToken(data.token);
    return data;
  },

  /**
   * Upload file (multipart/form-data)
   */
  async upload(file) {
    const formData = new FormData();
    formData.append("file", file);

    const res = await apiFetch("/api/upload", {
      method: "POST",
      body: formData,
      // Note: Fetch handles setting Content-Type for FormData automatically,
      // do NOT set Content-Type header manually here.
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "File upload failed");
    }
    return data; // { fileKey, fileUrl, originalFilename, sizeBytes }
  },

  /**
   * Publish a deliverable version page
   */
  async publish(payload) {
    const res = await apiFetch("/api/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      const error = new Error(data.error || "Publish failed");
      error.status = res.status; // capture status code (e.g. 409 conflict)
      throw error;
    }
    return data;
  },

  /**
   * Get all published deliverables
   */
  async getDeliverables() {
    const res = await fetch(`${API_BASE_URL}/api/deliverables`);
    if (!res.ok) {
      throw new Error("Failed to fetch deliverables list");
    }
    return res.json();
  },

  /**
   * Get a single deliverable by slug
   */
  async getDeliverable(slug) {
    const res = await fetch(`${API_BASE_URL}/api/deliverables/${slug}`);
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch deliverable for slug: ${slug}`);
    }
    return res.json();
  },
};
