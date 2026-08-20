# Kidzonia School CRM

A comprehensive school management and parent communication platform built for Kidzonia.

## Architecture

This project is a monorepo consisting of:
- **`server/`**: A Node.js backend using raw HTTP/Express routing patterns. It uses a custom in-memory transactional database engine (written in plain JS, persisting to a local JSON file) designed for high speed and rapid prototyping without external dependencies.
- **`src/`**: A React frontend built with Vite. It features a modern, mobile-first design system with custom CSS (no Tailwind/Bootstrap) adhering to the Kidzonia brand guidelines (Marmalade, Teal, Ink). It uses Zustand for global state and React Query for data fetching.

## Features

### Staff / Admin Portal
- **CRM & Admissions:** Track leads, conduct follow-ups, collect application forms, and manage the student onboarding pipeline.
- **Student Directory:** Comprehensive student profiles, classes, sections, capacity tracking, and attendance management.
- **Fees & Finance:** Define fee heads, create fee structures, assign them to students, generate invoices, track payments, and view finance reports.
- **Daily Operations:** Manage daily logs (meals, nap, health, mood, diaper), handle check-ins/outs, manage photo albums, assign homework, and post to the diary feed.
- **Communications:** Send rich announcements (with read/acknowledge tracking), real-time chat with parents/staff, school calendar and event RSVPs, and share downloadable worksheets.
- **Settings:** Manage branches, academic years, programs, user accounts, and fine-grained role-based permission matrices. Also features a comprehensive audit log.

### Parent Portal (Mobile-First)
- **Home:** Today strip summarizing attendance, meals, naps, and health alerts. Interactive activity feed (like, comment), and homework view.
- **Attendance:** Monthly calendar view of present/absent/late/leave days.
- **Fees:** View pending invoices, pay online (simulated gateway integration), and download PDF-like receipts.
- **Chat:** Direct messaging with class teachers and office staff.
- **Notices & Calendar:** Acknowledge important notices and RSVP to school events (holidays, PTMs, functions).
- **Profile:** Manage multiple children (switch between them seamlessly), update media sharing consents, and configure notification preferences.

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)

### Installation

1. **Clone the repository.**
2. **Install frontend dependencies:**
   ```bash
   npm install
   ```
3. **Install backend dependencies:**
   ```bash
   cd server
   npm install
   ```

### Running the App

1. **Start the backend server:**
   ```bash
   cd server
   npm run dev
   ```
   The server will start on port 3001 and create a local database file (`db.json` by default).

2. **Start the frontend app:**
   In a new terminal window:
   ```bash
   npm run dev
   ```
   The Vite dev server will start (typically on port 5173).

## Testing

The backend includes a comprehensive end-to-end integration test suite using the native Node.js test runner.

```bash
cd server
npm test
```

## Demo Credentials
To explore the system, log in using the following test accounts:
- **Super Admin:** `admin@kidzonia.com` / `password`
- **Branch Admin:** `admin_main@kidzonia.com` / `password`
- **Teacher:** `teacher1@kidzonia.com` / `password`
- **Parent:** *Created automatically when an application is admitted, password is `password`*

---
*Built as Phase 1 of the Kidzonia CRM digital transformation.*
