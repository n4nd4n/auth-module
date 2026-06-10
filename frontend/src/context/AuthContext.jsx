import { createContext, useContext, useState, useEffect, useRef } from 'react';
import api, { isTokenExpired } from '../utils/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const isCheckingAuth = useRef(false);

  useEffect(() => {
    if (!isCheckingAuth.current) {
      checkAuth();
    }
  }, []);

  // Runs on every page load or refresh.
  // Checks if the accessToken is still valid before making any API calls.
  // If expired, attempts a silent refresh using the httpOnly cookie.
  // This prevents a wasted failing request to a protected endpoint.
  const checkAuth = async () => {
    if (isCheckingAuth.current) return;
    isCheckingAuth.current = true;

    try {
      const token = localStorage.getItem('accessToken');
      if (token && !isTokenExpired(token)) {
        const response = await api.get('/users/profile');
        setUser(response.data);
      } else if (token) {
        // Token exists but is expired, try silent refresh
        await silentRefresh();
      }
    } catch (error) {
      console.error('checkAuth error:', error);
      localStorage.removeItem('accessToken');
      setUser(null);
    } finally {
      setLoading(false);
      isCheckingAuth.current = false;
    }
  };

  // Attempts to get a new accessToken using the httpOnly refresh_token cookie.
  // Called when the accessToken is missing or expired on page load.
  // If this also fails, the refreshToken is expired and the user must log in again.
  const silentRefresh = async () => {
    try {
      const response = await api.post('/auth/refresh');
      const { accessToken } = response.data;

      localStorage.setItem('accessToken', accessToken);
      api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;

      // Fetch user profile after successful token refresh
      const profileResponse = await api.get('/users/profile');
      setUser(profileResponse.data);
    } catch (error) {
      console.error('silentRefresh error:', error);
      localStorage.removeItem('accessToken');
      setUser(null);
    }
  };

  const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    const { accessToken, user: userData } = response.data;

    localStorage.setItem('accessToken', accessToken);
    api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
    setUser(userData);

    return response.data;
  };

  const register = async (fullName, email, password, confirmPassword) => {
    const response = await api.post('/auth/register', {
      fullName,
      email,
      password,
      confirmPassword,
    });

    const { accessToken, user: userData } = response.data;
    localStorage.setItem('accessToken', accessToken);
    api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
    setUser(userData);

    return response.data;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('accessToken');
      delete api.defaults.headers.common.Authorization;
      setUser(null);
    }
  };

  const forgotPassword = async (email) => {
    const response = await api.post('/auth/forgot-password', { email });
    return response.data;
  };

  const resetPassword = async (email, otp, newPassword, confirmNewPassword) => {
    const response = await api.post('/auth/reset-password', {
      email,
      otp,
      newPassword,
      confirmNewPassword,
    });
    return response.data;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        forgotPassword,
        resetPassword,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
