import { io } from 'socket.io-client';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:5002';

const socket = io(SERVER_URL, {
    autoConnect: false,
    withCredentials: true,
});

// Expose for debugging
if (typeof window !== 'undefined') window.__socket = socket;

export default socket;
export { SERVER_URL };
