Alright, here’s your README formatted clean and professional. No fluff, no drama, just the markdown you asked for.

---

# **Minimalist Focus Hub & AI Task Generator**

A modern, single-page productivity dashboard built with **React** and **Vite**, merging Pomodoro-based focus cycles with real-time task tracking and AI-powered goal breakdown.

---

## **🛠️ Technology Stack**

This project uses a lightweight, modular architecture built around modern React patterns and cloud services.

### **Core Technologies**

* **Frontend:** React + Vite
* **Styling:** Tailwind CSS
* **Database:** Google Cloud Firestore
* **Authentication:** Firebase Auth
* **AI Backend:** Gemini API (gemini-2.5-flash-preview-09-2025)

---

## **✨ Key Features**

* **AI-Powered Task Generation**
  Break down big goals into 5–8 actionable tasks using Gemini.

* **Real-time To-Do List**
  Tasks sync instantly using Firestore.

* **Pomodoro Timer**
  Classic 25-minute work timer with built-in break transitions.

* **Focus Music**
  Save and embed a custom YouTube URL.

* **Dashboard + Calendar View**
  Track stats and visualize upcoming tasks.

---

## **🚀 Local Development Setup**

This setup gives you an optimized React + Vite environment with HMR.

### **Clone the Repository**

```sh
git clone https://github.com/FsocietyVoid/Todo-webapp-gemini.git
cd Todo-webapp-gemini
```

### **Install Dependencies**

```sh
npm install
```

### **Run Development Server**

```sh
npm run dev
```

---

## **📦 Deployment & Environment Variables**

To deploy (e.g., on Vercel), configure the following environment variables:

| Variable               | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `GEMINI_API_KEY`       | Required for AI task generation                  |
| `__firebase_config`    | Complete Firebase config as a single JSON string |
| `__initial_auth_token` | Used by hosting platform for persistent login    |
| `__app_id`             | Unique application ID used for Firestore pathing |

---

## **📏 ESLint & Production Setup**

If you plan to scale this project, consider:

* Switching to **TypeScript**
* Enabling **type-aware ESLint rules**
* Using the TS template for smoother integration

---

If you want, I can turn this into a polished GitHub-style README with badges, screenshots, or an architecture diagram.
