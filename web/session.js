// The logged-in account's session token, kept in this browser (both pages read it).
const KEY = "horizon-account-token";

export const token = () => {
    try {
        return localStorage.getItem(KEY) ?? "";
    } catch {
        return "";
    }
};

export const setToken = (value) => {
    try {
        if (value) localStorage.setItem(KEY, value);
        else localStorage.removeItem(KEY);
    } catch {
        // Storage blocked: the session lasts until the page closes.
    }
};
