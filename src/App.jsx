import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, addDoc, serverTimestamp, getDoc } from 'firebase/firestore'; 

// --- Icon Imports (using lucide-react, assumed available) ---
import { Clock, CheckCircle, Circle, Calendar, List, Play, Pause, RotateCcw, Zap, Music, BarChart, X, Link, Save } from 'lucide-react';

// =================================================================
// 1. FIREBASE & AUTH SETUP (Mandatory Global Variables)
// =================================================================

// IMPORTANT: ALL sensitive keys here are now placeholders to ensure the file is safe for GitHub.
// The Canvas runtime provides the actual values via global variables.
const HARDCODED_FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY_PLACEHOLDER",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:23456789012:web:abcdefg12345",
  measurementId: "G-XXXXXXXXXX"
};

const firebaseConfig = typeof __firebase_config !== 'undefined'
  ? JSON.parse(__firebase_config)
  : HARDCODED_FIREBASE_CONFIG;

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'minimal-todo-app';

// Default focus music playlist, used if user hasn't saved a custom one
const DEFAULT_YT_PLAYLIST = "https://www.youtube.com/embed/videoseries?list=PLQ_oFj9qU2sU99Uq-Wp6jC11l20NfX2P3";

// =================================================================
// 2. GEMINI API SETUP & HELPERS
// =================================================================

// FIX: Check for the environment variable (REACT_APP_GEMINI_API_KEY) for Vercel deployment.
// If the variable exists (i.e., we are in Vercel), use it. Otherwise, use the empty string 
// which is handled by the local Canvas environment's runtime injection.
const GEMINI_API_KEY = (typeof process !== 'undefined' && process.env.REACT_APP_GEMINI_API_KEY)
  ? process.env.REACT_APP_GEMINI_API_KEY
  : ""; 

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";


/**
 * Executes a fetch request with exponential backoff for handling rate limits.
 */
const fetchWithBackoff = async (url, options, maxRetries = 5) => {
    let delay = 1000;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429) {
                if (i === maxRetries - 1) throw new Error("API rate limit exceeded after max retries.");
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
                continue;
            }
            if (!response.ok) {
                 const errorBody = await response.text();
                 throw new Error(`API call failed with status ${response.status}: ${errorBody}`);
            }
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
};

// =================================================================
// 3. CORE UTILITY FUNCTIONS
// =================================================================

// Pomodoro Timer Constants
const WORK_TIME = 25 * 60; // 25 minutes in seconds
const SHORT_BREAK = 5 * 60; // 5 minutes in seconds
const LONG_BREAK = 15 * 60; // 15 minutes in seconds
const CYCLE_LENGTH = 4; // 4 work sessions before a long break

const formatTime = (seconds) => {
  const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
};

const formatDate = (date) => {
  if (!date) return '';
  try {
    if (!(date instanceof Date)) return date; 

    // Use local date getters to prevent time zone issues 
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return date;
  }
};

/**
 * Parses a YouTube URL (video or playlist) and converts it to an embed URL.
 */
const getEmbedUrl = (url) => {
    if (!url) return DEFAULT_YT_PLAYLIST;

    try {
        const urlObj = new URL(url);
        const params = urlObj.searchParams;

        if (params.has('list')) {
            const playlistId = params.get('list');
            return `https://www.youtube.com/embed/videoseries?list=${playlistId}&controls=1`;
        }
        
        if (params.has('v') && urlObj.hostname.includes('youtube.com')) {
            const videoId = params.get('v');
            return `https://www.youtube.com/embed/${videoId}?controls=1`;
        }
        
        if (urlObj.hostname.includes('youtu.be')) {
             const videoId = urlObj.pathname.substring(1); 
             return `https://www.youtube.com/embed/${videoId}?controls=1`;
        }

        if (url.includes('/embed/')) {
            return url;
        }

    } catch (error) {
        // console.warn("Invalid YouTube URL provided, using default.", error);
    }
    
    return DEFAULT_YT_PLAYLIST;
};


// =================================================================
// 4. SEPARATE COMPONENTS
// =================================================================

/**
 * TaskCard Component
 */
const TaskCard = React.memo(({ task, toggleTaskCompleted, openEditModal, deleteTask }) => (
    <div className={`p-4 mb-2 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow flex items-center justify-between border-l-4 ${task.completed ? 'border-green-300' : 'border-gray-300'}`}>
      <div className="flex items-center space-x-3 flex-1 min-w-0">
        <button
          onClick={() => toggleTaskCompleted(task.id, task.completed)}
          className={`p-1 rounded-full border transition-colors ${task.completed ? 'bg-green-100 border-green-400 text-green-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
          aria-label={task.completed ? "Mark as incomplete" : "Mark as complete"}
        >
          {task.completed ? <CheckCircle size={18} fill="currentColor" className="text-green-500" /> : <Circle size={18} className="text-gray-400" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-gray-800 font-medium truncate ${task.completed ? 'line-through text-gray-500' : ''}`}>
            {task.title}
          </p>
          {task.scheduledDate && (
            <div className="flex items-center text-xs text-gray-400 mt-0.5">
              <Calendar size={12} className="mr-1" />
              <span>{task.scheduledDate}</span>
            </div>
          )}
        </div>
      </div>
      <div className="space-x-2 flex-shrink-0">
        <button
          onClick={() => openEditModal(task)}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-sm"
        >
          Edit
        </button>
        <button
          onClick={() => deleteTask(task.id)}
          className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm"
        >
          Delete
        </button>
      </div>
    </div>
));


/**
 * Modal Component
 */
const Modal = React.memo(({ showModal, setShowModal, modalType, editingTask, newTaskTitle, setNewTaskTitle, newTaskDate, setNewTaskDate, handleModalSubmit }) => {
    if (!showModal) return null;

    const modalTitle = modalType === 'add' ? 'Add New Task' : 'Edit Task';

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-md" onClick={() => setShowModal(false)}>
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md m-4" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-4 border-b pb-3">
            <h2 className="text-xl font-bold text-gray-800">{modalTitle}</h2>
            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-50">
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleModalSubmit}>
            <div className="mb-4">
              <label htmlFor="task-title" className="block text-sm font-medium text-gray-700 mb-1">Task Title</label>
              <input
                id="task-title"
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="e.g., Finish project proposal"
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-blue-500 focus:border-blue-500 transition-colors"
                required
              />
            </div>
            <div className="mb-6">
              <label htmlFor="task-date" className="block text-sm font-medium text-gray-700 mb-1">Schedule Date (Optional)</label>
              <input
                id="task-date"
                type="date"
                value={newTaskDate}
                onChange={(e) => setNewTaskDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-700 transition-colors shadow-md"
              >
                {modalType === 'add' ? 'Add Task' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
});


/**
 * PomodoroTimer Component
 */
const PomodoroTimer = React.memo(({ sessionType, timeLeft, timerStatus, startTimer, pauseTimer, resetTimer, switchSession, sessionCount }) => {
    const sessionLabel = useMemo(() => {
        switch (sessionType) {
          case 'work': return 'Focus Time';
          case 'short-break': return 'Short Break';
          case 'long-break': return 'Long Break';
          default: return 'Ready';
        }
    }, [sessionType]);

    const displayTime = formatTime(timeLeft);
    const baseColor = sessionType === 'work' ? 'border-red-500' : 'border-green-500';
    const textColor = sessionType === 'work' ? 'text-red-500' : 'text-green-500';
    const bgColor = sessionType === 'work' ? 'bg-red-50' : 'bg-green-50';

    return (
      <div className={`p-4 rounded-xl shadow-inner ${bgColor} transition-all duration-500`}>
        <h3 className="font-semibold text-lg text-gray-800 mb-1 flex items-center">
          <Clock size={18} className="mr-2" /> Pomodoro
        </h3>
        <div className="flex justify-between items-center mb-3">
          <p className={`text-sm font-medium ${textColor} capitalize`}>{sessionLabel}</p>
          <p className="text-sm text-gray-500">Session: {sessionCount}</p>
        </div>

        {/* Timer Display */}
        <div className={`relative w-full aspect-square max-w-[200px] mx-auto rounded-full ${baseColor} border-4 my-4`}>
          <div className="absolute inset-0 flex items-center justify-center">
            <p className={`text-6xl font-extrabold ${textColor} tabular-nums`}>{displayTime}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex justify-center space-x-3 mt-4">
          {timerStatus === 'running' ? (
            <button
              onClick={pauseTimer}
              className="p-3 rounded-full bg-gray-900 text-white shadow-lg hover:bg-gray-700 transition-colors flex items-center"
              aria-label="Pause Timer"
            >
              <Pause size={24} />
            </button>
          ) : (
            <button
              onClick={startTimer}
              className="p-3 rounded-full bg-gray-900 text-white shadow-lg hover:bg-gray-700 transition-colors flex items-center"
              aria-label="Start Timer"
            >
              <Play size={24} />
            </button>
          )}
          <button
            onClick={resetTimer}
            className="p-3 rounded-full bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
            aria-label="Reset Timer"
          >
            <RotateCcw size={24} />
          </button>
        </div>
        <button
            onClick={switchSession}
            className="w-full mt-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            Skip to Next Session
          </button>
      </div>
    );
});


/**
 * MusicIntegration Component
 */
const MusicIntegration = React.memo(({ 
    customPlaylistUrl, 
    embedUrl, 
    inputUrl, 
    setInputUrl, 
    isMusicSettingsOpen, 
    setIsMusicSettingsOpen, 
    saveMusicUrl 
}) => (
    <div className="p-4 rounded-xl shadow-inner bg-white mt-6">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-lg text-gray-800 flex items-center">
          <Music size={18} className="mr-2" /> Focus Music
        </h3>
        <button 
            onClick={() => setIsMusicSettingsOpen(!isMusicSettingsOpen)}
            className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
            title="Edit Music Link"
        >
            <Link size={18} />
        </button>
      </div>

      {isMusicSettingsOpen && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <label htmlFor="music-link" className="block text-xs font-medium text-gray-600 mb-1">Paste YouTube URL (Video or Playlist)</label>
              <div className="flex space-x-2">
                  <input
                      id="music-link"
                      type="text"
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="e.g., https://www.youtube.com/watch?v=..."
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                      onClick={saveMusicUrl}
                      className="p-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
                      title="Save Link"
                  >
                      <Save size={20} />
                  </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Saves link for this user.</p>
          </div>
      )}

      <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
        <iframe
          width="100%"
          height="100%"
          src={embedUrl}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Focus Music Player"
          className="w-full h-full"
        ></iframe>
      </div>
    </div>
));


/**
 * TaskGeneratorForm Component (State is now managed LOCALLY)
 */
const TaskGeneratorForm = React.memo(({ 
    onSubmitPrompt, 
    isGeneratingTasks, 
    generationError 
}) => {
    // Input state is local to this component, guaranteeing stability against parent re-renders
    const [taskPrompt, setTaskPrompt] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault(); 
        if (!taskPrompt.trim()) return;
        onSubmitPrompt(taskPrompt); 
        setTaskPrompt(''); // Clear local state after submission
    };

    return (
        <div className="mb-8 p-4 bg-white rounded-xl shadow-lg border border-gray-100">
            <h2 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
                <Zap size={20} className="mr-2 text-blue-500" /> AI Task Generator
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
                <input
                    type="text"
                    value={taskPrompt}
                    // This onChange handler controls only local state
                    onChange={(e) => setTaskPrompt(e.target.value)} 
                    placeholder="Enter a high-level goal (e.g., 'Plan a week-long trip to Japan' or 'Write a report on Q3 sales')"
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    disabled={isGeneratingTasks}
                    required
                />
                <button
                    type="submit"
                    className="w-full flex items-center justify-center px-4 py-2 bg-blue-500 text-white rounded-xl shadow-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:bg-blue-400"
                    disabled={isGeneratingTasks || !taskPrompt.trim()}
                >
                    {isGeneratingTasks ? (
                        <svg className="animate-spin h-5 w-5 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <Zap size={20} className="mr-2" />
                    )}
                    {isGeneratingTasks ? 'Generating Tasks...' : 'Generate Actionable Tasks'}
                </button>
            </form>
            {generationError && (
                <p className="mt-3 text-red-600 text-sm p-2 bg-red-50 border border-red-200 rounded-lg">
                    Error: {generationError}
                </p>
            )}
        </div>
    );
});


// =================================================================
// 5. EXTERNAL TODO LIST COMPONENT (Structural Fix)
// =================================================================

/**
 * TodoList Component (Moved outside App for rendering stability)
 */
const TodoList = React.memo(({ 
    sortedTasks, 
    stats, 
    openAddModal, 
    generateTasksFromPrompt, 
    isGeneratingTasks, 
    generationError,
    toggleTaskCompleted,
    openEditModal,
    deleteTask
}) => {
    
    // Client-side sorting applied to the stable 'sortedTasks' prop
    const pendingTasks = sortedTasks.filter(t => !t.completed).sort((a, b) => {
        // Secondary sort: Pending tasks ordered by scheduledDate ascending (earliest first)
        const dateA = a.scheduledDate || '9999-12-31'; // Put unscheduled tasks last
        const dateB = b.scheduledDate || '9999-12-31';
        if (dateA < dateB) return -1;
        if (dateA > dateB) return 1;
        return 0;
    });
    
    const completedTasks = sortedTasks.filter(t => t.completed);

    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Your Tasks ({stats.pending})</h1>
          <button
            onClick={openAddModal}
            className="flex items-center px-4 py-2 bg-gray-900 text-white rounded-xl shadow-lg hover:bg-gray-700 transition-colors"
          >
            <Zap size={20} className="mr-2" /> New Task
          </button>
        </div>
        
        {/* Render the isolated Task Generator Form */}
        <TaskGeneratorForm
            onSubmitPrompt={generateTasksFromPrompt}
            isGeneratingTasks={isGeneratingTasks}
            generationError={generationError}
        />

        <div className="space-y-4">
          {pendingTasks.length > 0 ? (
            pendingTasks.map(task => 
                <TaskCard 
                    key={task.id} 
                    task={task} 
                    toggleTaskCompleted={toggleTaskCompleted}
                    openEditModal={openEditModal}
                    deleteTask={deleteTask}
                />
            )
          ) : (
            <p className="text-gray-500 p-4 border border-dashed border-gray-200 rounded-xl bg-white text-center">
              All clear! Time to relax or add a new task.
            </p>
          )}
        </div>

        <h2 className="text-xl font-semibold text-gray-600 mt-10 mb-4 border-b pb-2">
          Completed ({stats.completed})
        </h2>
        <div className="space-y-4 opacity-70">
          {completedTasks.map(task => 
              <TaskCard 
                key={task.id} 
                task={task} 
                toggleTaskCompleted={toggleTaskCompleted}
                openEditModal={openEditModal}
                deleteTask={deleteTask}
              />
          )}
        </div>
      </div>
    );
});


// =================================================================
// 6. CALENDAR AND STATS COMPONENTS (No structural change needed)
// =================================================================

const CalendarView = React.memo(({ tasks }) => {
    const today = new Date();
    const [currentDate, setCurrentDate] = useState(today);
    
    // Calculate calendar boundaries based on currentDate
    const firstDayOfMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), [currentDate]);
    const lastDayOfMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0), [currentDate]);
    const daysInMonth = useMemo(() => lastDayOfMonth.getDate(), [lastDayOfMonth]);
    const startDayOfWeek = useMemo(() => firstDayOfMonth.getDay(), [firstDayOfMonth]); // 0 for Sunday

    // Create a map of tasks keyed by their scheduled date (YYYY-MM-DD)
    const dateMap = useMemo(() => {
      return tasks.reduce((map, task) => {
        if (task.scheduledDate) {
          map[task.scheduledDate] = [...(map[task.scheduledDate] || []), task];
        }
        return map;
      }, {});
    }, [tasks]);

    const getDayTasks = useCallback((day) => {
        // The formatDate helper now ensures the string matches the local date of the cell
        const dayDate = formatDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
        return dateMap[dayDate] || [];
      }, [currentDate, dateMap]);

    const changeMonth = useCallback((delta) => {
      setCurrentDate(prev => {
        const newDate = new Date(prev);
        newDate.setMonth(prev.getMonth() + delta);
        return newDate;
      });
    }, []);

    const calendarCells = useMemo(() => {
        const cells = [];
        // Fill leading empty cells
        for (let i = 0; i < startDayOfWeek; i++) {
          cells.push(<div key={`empty-${i}`} className="p-2 border-r border-b border-gray-100 bg-gray-50/50"></div>);
        }

        // Fill day cells
        for (let day = 1; day <= daysInMonth; day++) {
          const tasksOnDay = getDayTasks(day);
          // Check for today only against local date components
          const isToday = day === today.getDate() && currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear();
          
          cells.push(
            <div
              key={day}
              className={`p-2 h-28 border-r border-b border-gray-100 transition-shadow overflow-y-auto cursor-default ${isToday ? 'bg-blue-50/50' : 'bg-white hover:shadow-inner'}`}
            >
              <div className={`font-semibold text-sm mb-1 ${isToday ? 'text-blue-600' : 'text-gray-800'}`}>
                {day}
              </div>
              <div className="space-y-1">
                {tasksOnDay.map(task => (
                  <div
                    key={task.id}
                    title={task.title}
                    className={`text-xs p-1 rounded-md truncate ${task.completed ? 'bg-green-100 text-green-700 line-through' : 'bg-red-100 text-red-700'}`}
                  >
                    {task.title}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return cells;
    }, [currentDate, daysInMonth, startDayOfWeek, getDayTasks]);


    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <button onClick={() => changeMonth(-1)} className="p-2 text-gray-600 hover:text-gray-900">&lt; Prev</button>
          <h1 className="text-2xl font-bold text-gray-800">
            {currentDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
          </h1>
          <button onClick={() => changeMonth(1)} className="p-2 text-gray-600 hover:text-gray-900">Next &gt;</button>
        </div>

        <div className="grid grid-cols-7 text-center font-medium text-gray-500 bg-gray-50 rounded-t-xl overflow-hidden">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="p-2 border-r last:border-r-0 border-gray-100">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l border-t border-gray-100 rounded-b-xl overflow-hidden shadow-lg bg-white">
          {calendarCells}
        </div>
      </div>
    );
});

const DashboardStats = React.memo(({ stats }) => (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-800 mb-8">Productivity Dashboard</h1>

      {/* Main Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {[{ title: 'Total Tasks', value: stats.total, color: 'text-gray-500', icon: List },
         { title: 'Completed Tasks', value: stats.completed, color: 'text-green-500', icon: CheckCircle },
         { title: 'Pending Tasks', value: stats.pending, color: 'text-red-500', icon: Clock }].map((item) => (
          <div key={item.title} className="bg-white p-6 rounded-xl shadow-lg border-t-4 border-gray-100 hover:shadow-xl transition-shadow">
            <item.icon size={24} className={`${item.color} mb-3`} />
            <p className="text-sm font-medium text-gray-500">{item.title}</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Completion Rate Chart (Textual representation) */}
      <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-blue-100">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Task Completion Rate</h2>
        <p className="text-5xl font-extrabold mb-4" style={{ color: `hsl(${stats.completionRate * 1.2}, 70%, 40%)` }}>
          {stats.completionRate}%
        </p>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className="h-2.5 rounded-full"
            style={{ width: `${stats.completionRate}%`, backgroundColor: `hsl(${stats.completionRate * 1.2}, 70%, 50%)` }}
          ></div>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          Keep up the great work! You've scheduled {stats.scheduled} tasks.
        </p>
      </div>
    </div>
));


// =================================================================
// 7. MAIN APP COMPONENT
// =================================================================

const App = () => {
  // --- Global State ---
  const [tasks, setTasks] = useState([]);
  const [viewMode, setViewMode] = useState('tasks'); // 'tasks', 'calendar', 'stats'
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- Music State ---
  const [customPlaylistUrl, setCustomPlaylistUrl] = useState(DEFAULT_YT_PLAYLIST);
  const [inputUrl, setInputUrl] = useState('');
  const [isMusicSettingsOpen, setIsMusicSettingsOpen] = useState(false);
  
  // Memoized embed URL for the iframe
  const embedUrl = useMemo(() => getEmbedUrl(customPlaylistUrl), [customPlaylistUrl]);

  // --- Pomodoro State ---
  const [timerStatus, setTimerStatus] = useState('stopped'); // 'stopped', 'running', 'paused'
  const [sessionType, setSessionType] = useState('work'); // 'work', 'short-break', 'long-break'
  const [timeLeft, setTimeLeft] = useState(WORK_TIME);
  const [sessionCount, setSessionCount] = useState(0);

  // --- Task Input State ---
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDate, setNewTaskDate] = useState(formatDate(new Date()));
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('add'); // 'add', 'edit'
  const [editingTask, setEditingTask] = useState(null);

  // --- Task Generation State ---
  const [isGeneratingTasks, setIsGeneratingTasks] = useState(false);
  const [generationError, setGenerationError] = useState(null);


  // =================================================================
  // A. FIREBASE INITIALIZATION AND AUTHENTICATION
  // =================================================================

  useEffect(() => {
    if (!firebaseConfig) return;

    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authentication = getAuth(app);

      setDb(firestore);
      // NOTE: Authentication instance doesn't need to be set in state here, 
      // but is used within the onAuthStateChanged listener below.

      // 1. Sign in listener to get user ID
      const unsubscribe = onAuthStateChanged(authentication, (user) => {
        if (user) {
          setUserId(user.uid);
          // Once authenticated, load settings
          loadUserSettings(firestore, user.uid);
        } else {
          // If no user and no custom token, sign in anonymously as a fallback
          if (!initialAuthToken) {
            signInAnonymously(authentication).catch(console.error);
          }
        }
        setIsAuthReady(true);
      });

      // 2. Custom Token Sign-In (runs once on load)
      const attemptSignIn = async () => {
        if (initialAuthToken) {
          await signInWithCustomToken(authentication, initialAuthToken).catch(console.error);
        } else if (!authentication.currentUser) {
          await signInAnonymously(authentication).catch(console.error);
        }
      };
      attemptSignIn();

      return () => unsubscribe();
    } catch (e) {
      console.error("Firebase initialization failed:", e);
    }
  }, []);

  // =================================================================
  // B. FIRESTORE REAL-TIME DATA SUBSCRIPTION & USER SETTINGS
  // =================================================================

  // Load User Settings (specifically music URL)
  const loadUserSettings = useCallback(async (firestore, uid) => {
    try {
        const settingsDocRef = doc(firestore, `artifacts/${appId}/users/${uid}/settings`, 'music');
        const docSnap = await getDoc(settingsDocRef);
        if (docSnap.exists()) {
            const savedUrl = docSnap.data().youtubeUrl;
            if (savedUrl) {
                setCustomPlaylistUrl(savedUrl);
                setInputUrl(savedUrl); // Initialize input field with saved value
            }
        }
    } catch (e) {
        console.error("Error loading user settings:", e);
    }
  }, []);

  // Save Music URL Setting (Memoized)
  const saveMusicUrl = useCallback(async () => {
    if (!db || !userId) return;
    const urlToSave = getEmbedUrl(inputUrl) === DEFAULT_YT_PLAYLIST ? null : inputUrl; // Save null if using default or invalid URL
    
    try {
        const settingsDocRef = doc(db, `artifacts/${appId}/users/${userId}/settings`, 'music');
        await setDoc(settingsDocRef, { youtubeUrl: urlToSave }, { merge: true });
        // Update the customPlaylistUrl state to trigger iframe source update *once*
        setCustomPlaylistUrl(urlToSave || DEFAULT_YT_PLAYLIST); 
        setIsMusicSettingsOpen(false);
        // console.log("Music URL saved successfully.");
    } catch (e) {
        console.error("Error saving user settings:", e);
    }
  }, [db, userId, inputUrl]);


  useEffect(() => {
    if (!isAuthReady || !userId || !db) return;

    const tasksCollectionPath = `artifacts/${appId}/users/${userId}/todos`;
    const q = query(collection(db, tasksCollectionPath));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newTasks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Convert Firestore timestamp to milliseconds if present, else null (for sorting)
        createdAt: doc.data().createdAt?.toMillis() || 0,
        completedAt: doc.data().completedAt?.toMillis() || null,
      }));
      setTasks(newTasks);
      // console.log(`Loaded ${newTasks.length} tasks for user ${userId}`);
    }, (error) => {
      console.error("Error fetching tasks:", error);
    });

    return () => unsubscribe();
  }, [db, userId, isAuthReady]);

  // =================================================================
  // C. TASK MANAGEMENT & GENERATION LOGIC (All Memoized)
  // =================================================================

  const addTask = useCallback(async (title, scheduledDate) => {
    if (!db || !userId || !title.trim()) {
        console.error("AddTask Failed: Firestore DB not initialized or title empty.");
        return;
    }

    try {
      const tasksCollectionPath = `artifacts/${appId}/users/${userId}/todos`;
      await addDoc(collection(db, tasksCollectionPath), {
        title: title.trim(),
        completed: false,
        scheduledDate: scheduledDate,
        createdAt: serverTimestamp(),
      });
      // console.log("Task added successfully.");
    } catch (e) {
      console.error("Error adding document: ", e);
    }
  }, [db, userId]);
  
  const addTasksBatch = useCallback(async (taskArray) => {
      if (!db || !userId) {
          console.error("Batch Add Failed: DB or User ID not initialized.");
          return;
      }
      const tasksCollectionPath = `artifacts/${appId}/users/${userId}/todos`;
      
      const batchPromises = taskArray.map(task => 
          addDoc(collection(db, tasksCollectionPath), {
              title: task.title.trim(),
              completed: false,
              // Use provided date or today's date if date is missing or invalid
              scheduledDate: task.scheduledDate && task.scheduledDate.match(/^\d{4}-\d{2}-\d{2}$/) 
                             ? task.scheduledDate 
                             : '',
              createdAt: serverTimestamp(),
          })
      );

      try {
          await Promise.all(batchPromises);
          // console.log(`Successfully added ${taskArray.length} tasks in batch.`);
      } catch (e) {
          console.error("Error during batch task addition:", e);
          throw new Error("Failed to save all generated tasks to the database.");
      }
  }, [db, userId]); 


  const generateTasksFromPrompt = useCallback(async (prompt) => {
    if (!prompt.trim() || !db || !userId) return;

    setIsGeneratingTasks(true);
    setGenerationError(null);

    const systemPrompt = "You are an expert project manager and productivity assistant. Your task is to break down the user's high-level goal into 5 to 8 concrete, actionable, small, and distinct sub-tasks. For each task, provide a concise title (max 10 words) and an optional scheduled date in YYYY-MM-DD format, or an empty string if a date is not applicable. Respond ONLY with the JSON array of tasks.";

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          description: "A list of actionable tasks derived from the user's prompt.",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Concise title for the task (max 10 words)." },
              scheduledDate: { type: "STRING", description: "Optional schedule date in YYYY-MM-DD format, or empty string." }
            },
            required: ["title"],
            propertyOrdering: ["title", "scheduledDate"]
          }
        }
      }
    };

    try {
      const response = await fetchWithBackoff(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      const generatedJsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!generatedJsonText) {
          throw new Error("Gemini returned no content or an invalid structure.");
      }

      // 1. Parse JSON
      const generatedTasks = JSON.parse(generatedJsonText);

      // 2. Validate and Save Tasks
      if (Array.isArray(generatedTasks) && generatedTasks.length > 0) {
        const validTasks = generatedTasks.filter(t => t.title && typeof t.title === 'string');
        if (validTasks.length > 0) {
            await addTasksBatch(validTasks);
        } else {
            throw new Error("Generated tasks were empty or invalid after parsing.");
        }
      } else {
        throw new Error("Gemini response did not contain a valid array of tasks.");
      }

    } catch (e) {
      console.error("Task generation failed:", e);
      setGenerationError(e.message || "Failed to generate tasks. Please try again.");
    } finally {
      setIsGeneratingTasks(false);
    }
  }, [db, userId, addTasksBatch]); // Dependencies are stable

  const updateTask = useCallback(async (taskId, newTitle, newScheduledDate) => {
    if (!db || !userId || !taskId) return;

    try {
      const tasksDocPath = `artifacts/${appId}/users/${userId}/todos/${taskId}`;
      await updateDoc(doc(db, tasksDocPath), {
        title: newTitle.trim(),
        scheduledDate: newScheduledDate,
      });
      setShowModal(false);
      setEditingTask(null);
    } catch (e) {
      console.error("Error updating document: ", e);
    }
  }, [db, userId]);

  const toggleTaskCompleted = useCallback(async (taskId, currentStatus) => {
    if (!db || !userId || !taskId) return;

    try {
      const tasksDocPath = `artifacts/${appId}/users/${userId}/todos/${taskId}`;
      await updateDoc(doc(db, tasksDocPath), {
        completed: !currentStatus,
        completedAt: !currentStatus ? serverTimestamp() : null
      });
    } catch (e) {
      console.error("Error toggling task status: ", e);
    }
  }, [db, userId]);

  const deleteTask = useCallback(async (taskId) => {
    if (!db || !userId || !taskId) return;

    try {
      const tasksDocPath = `artifacts/${appId}/users/${userId}/todos/${taskId}`;
      await deleteDoc(doc(db, tasksDocPath));
    } catch (e) {
      console.error("Error deleting document: ", e);
    }
  }, [db, userId]);

  // Modal handlers
  const handleModalSubmit = useCallback((e) => {
    e.preventDefault();
    if (modalType === 'add') {
      addTask(newTaskTitle, newTaskDate);
    } else if (modalType === 'edit' && editingTask) {
      updateTask(editingTask.id, newTaskTitle, newTaskDate);
    }
  }, [modalType, newTaskTitle, newTaskDate, editingTask, addTask, updateTask]);

  const openAddModal = useCallback(() => {
    setModalType('add');
    setNewTaskTitle('');
    setNewTaskDate(formatDate(new Date()));
    setEditingTask(null);
    setShowModal(true);
  }, []);

  const openEditModal = useCallback((task) => {
    setModalType('edit');
    setNewTaskTitle(task.title);
    // Ensure date is valid for input type="date"
    setNewTaskDate(task.scheduledDate || formatDate(new Date())); 
    setEditingTask(task);
    setShowModal(true);
  }, []);


  // =================================================================
  // D. POMODORO TIMER LOGIC (All Memoized)
  // =================================================================

  const getSessionDuration = useCallback((type) => {
    switch (type) {
      case 'work': return WORK_TIME;
      case 'short-break': return SHORT_BREAK;
      case 'long-break': return LONG_BREAK;
      default: return WORK_TIME;
    }
  }, []);

  const startTimer = useCallback(() => setTimerStatus('running'), []);
  const pauseTimer = useCallback(() => setTimerStatus('paused'), []);

  const resetTimer = useCallback(() => {
    setTimerStatus('stopped');
    setTimeLeft(getSessionDuration(sessionType));
  }, [sessionType, getSessionDuration]);

  const switchSession = useCallback(() => {
    let nextType;
    let nextCount = sessionCount;

    if (sessionType === 'work') {
      nextCount++;
      if (nextCount % CYCLE_LENGTH === 0) {
        nextType = 'long-break';
      } else {
        nextType = 'short-break';
      }
    } else {
      nextType = 'work';
    }

    setSessionType(nextType);
    setSessionCount(nextCount);
    setTimeLeft(getSessionDuration(nextType));
    setTimerStatus('stopped');
  }, [sessionType, sessionCount, getSessionDuration]);


  useEffect(() => {
    if (timerStatus === 'running') {
      const interval = setInterval(() => {
        setTimeLeft((prevTime) => {
          if (prevTime <= 1) {
            switchSession();
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [timerStatus, switchSession]);

  // =================================================================
  // E. STATS CALCULATION (Memoized)
  // =================================================================

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const pending = total - completed;
    const scheduled = tasks.filter(t => t.scheduledDate).length;
    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(0) : 0;
    return { total, completed, pending, scheduled, completionRate };
  }, [tasks]);
  
  // Tasks sorted for the TodoList (Memoized)
  const sortedTasks = useMemo(() => {
      return tasks.slice().sort((a, b) => {
          // Sort by creation time (descending)
          return b.createdAt - a.createdAt; 
      });
  }, [tasks]);


  // =================================================================
  // F. RENDER COMPONENTS - Logic
  // =================================================================

  const renderMainContent = () => {
    switch (viewMode) {
      case 'calendar':
        return <CalendarView tasks={tasks} />;
      case 'stats':
        return <DashboardStats stats={stats} />;
      case 'tasks':
      default:
        // Pass all stable props to the external TodoList component
        return (
            <TodoList 
                sortedTasks={sortedTasks}
                stats={stats}
                openAddModal={openAddModal}
                generateTasksFromPrompt={generateTasksFromPrompt}
                isGeneratingTasks={isGeneratingTasks}
                generationError={generationError}
                toggleTaskCompleted={toggleTaskCompleted}
                openEditModal={openEditModal}
                deleteTask={deleteTask}
            />
        );
    }
  };

  // Memoize the Music Integration component instance to prevent re-rendering when only the timer updates
  const MemoizedMusicIntegration = useMemo(() => (
    <MusicIntegration 
        customPlaylistUrl={customPlaylistUrl}
        embedUrl={embedUrl}
        inputUrl={inputUrl}
        setInputUrl={setInputUrl}
        isMusicSettingsOpen={isMusicSettingsOpen}
        setIsMusicSettingsOpen={setIsMusicSettingsOpen}
        saveMusicUrl={saveMusicUrl}
    />
  ), [customPlaylistUrl, embedUrl, inputUrl, isMusicSettingsOpen, saveMusicUrl]);

  // Memoize the Pomodoro Timer to prevent re-rendering of the entire element tree on App re-render, 
  // ensuring only the props that change (timeLeft, timerStatus) cause updates.
  const MemoizedPomodoroTimer = useMemo(() => (
    <PomodoroTimer 
        sessionType={sessionType}
        timeLeft={timeLeft}
        timerStatus={timerStatus}
        startTimer={startTimer}
        pauseTimer={pauseTimer}
        resetTimer={resetTimer}
        switchSession={switchSession}
        sessionCount={sessionCount}
    />
  ), [sessionType, timeLeft, timerStatus, sessionCount, startTimer, pauseTimer, resetTimer, switchSession]);


  // =================================================================
  // G. MAIN LAYOUT RENDER
  // =================================================================

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 text-gray-500">
        <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Loading application...
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gray-50 flex text-gray-800">

      {/* Sidebar / Tools Panel */}
      <aside className="w-80 min-h-screen bg-gray-100 p-6 flex flex-col shadow-xl z-10">
        <h1 className="text-3xl font-extrabold mb-8 text-gray-900">Focus Hub</h1>

        {/* Navigation */}
        <nav className="space-y-2 mb-8">
          {[
            { id: 'tasks', name: 'To-Do List', icon: List },
            { id: 'calendar', name: 'Schedules & Calendar', icon: Calendar },
            { id: 'stats', name: 'Dashboard', icon: BarChart },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setViewMode(item.id)}
              className={`w-full flex items-center p-3 rounded-xl transition-all font-medium ${
                viewMode === item.id
                  ? 'bg-white shadow-md text-gray-900'
                  : 'text-gray-600 hover:bg-gray-200 hover:text-gray-800'
              }`}
            >
              <item.icon size={20} className="mr-3" />
              {item.name}
            </button>
          ))}
        </nav>

        {/* Pomodoro Timer (Memoized) */}
        {MemoizedPomodoroTimer}

        {/* Music Integration (Memoized) */}
        {MemoizedMusicIntegration}

        {/* User Info for Debugging/Sharing */}
        <div className="mt-auto pt-6 border-t border-gray-200">
           <p className="text-xs text-gray-400">User ID (for Persistence):</p>
           <p className="text-sm font-mono text-gray-600 truncate">{userId}</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        {renderMainContent()}
      </main>

      {/* Modal Overlay */}
      <Modal 
          showModal={showModal}
          setShowModal={setShowModal}
          modalType={modalType}
          editingTask={editingTask}
          newTaskTitle={newTaskTitle}
          setNewTaskTitle={setNewTaskTitle}
          newTaskDate={newTaskDate}
          setNewTaskDate={setNewTaskDate}
          handleModalSubmit={handleModalSubmit}
      />
    </div>
  );
};

export default App;