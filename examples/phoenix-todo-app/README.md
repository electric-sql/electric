# Phoenix + ElectricSQL + React Todo App

A full-stack todo application demonstrating real-time synchronization between Phoenix backend and React frontend using ElectricSQL.

## 🏗️ Architecture

- **Phoenix Backend** (`phoenix/`) - Elixir/Phoenix API with embedded ElectricSQL sync
- **React Frontend** (`frontend/`) - Modern React app with real-time data sync
- **PostgreSQL** - Database with logical replication for real-time sync

## 📁 Project Structure

```
phoenix-todo-app/
├── phoenix/           # Phoenix backend with ElectricSQL
│   ├── lib/           # Phoenix application code
│   ├── config/        # Configuration files
│   ├── priv/          # Static assets and migrations
│   ├── test/          # Tests
│   ├── mix.exs        # Elixir dependencies
│   ├── start.sh       # Phoenix-specific start script
│   └── ...
├── frontend/          # React frontend
│   ├── src/           # React source code
│   ├── public/        # Static assets
│   ├── package.json   # NPM dependencies
│   └── ...
├── start.sh           # Main start script
├── README.md          # This file
└── LICENSE
```

## 🚀 Quick Start

### Prerequisites

- **PostgreSQL 16+** with logical replication enabled
- **Elixir 1.18+** and **Phoenix**
- **Node.js 18+** and **npm**

### Setup

1. **Clone and navigate to the project:**
   ```bash
   cd phoenix-todo-app
   ```

2. **Configure PostgreSQL for logical replication:**
   ```bash
   # Edit PostgreSQL config
   sudo sed -i 's/wal_level = replica/wal_level = logical/' /etc/postgresql/16/main/postgresql.conf
   
   # Restart PostgreSQL
   sudo systemctl restart postgresql
   ```

3. **Install dependencies:**
   ```bash
   # Phoenix dependencies
   cd phoenix && mix deps.get
   
   # React dependencies  
   cd ../frontend && npm install
   cd ..
   ```

4. **Setup database:**
   ```bash
   cd phoenix && mix ecto.setup
   cd ..
   ```

## 🎯 Running the Application

Use the main start script for the best experience:

```bash
./start.sh
```

### Options:

1. **🚀 Production Mode** - Single Phoenix server serves everything
   - React app built and served by Phoenix
   - No CORS complexity
   - Access at: `http://localhost:4000`

2. **🔧 Development Mode** - Separate servers with hot reload
   - Phoenix backend: `http://localhost:4000`
   - React frontend: `http://localhost:5173` (with hot reload)

3. **🧪 Backend Only** - Phoenix server only
   - Useful for API testing
   - Frontend can be started separately later

## 🛠️ Manual Commands

### Phoenix Backend
```bash
cd phoenix
mix phx.server
# Runs at http://localhost:4000
```

### React Frontend
```bash
cd frontend
npm run dev
# Runs at http://localhost:5173
```

### Production Build
```bash
cd frontend
npm run build
cp -r dist/* ../phoenix/priv/static/
cd ../phoenix
mix phx.server
# Single server at http://localhost:4000
```

## 🔧 Development

### Project Features

- **Real-time Sync**: Changes in one browser tab instantly appear in others
- **Offline Support**: Works offline, syncs when connection returns
- **Optimistic Updates**: UI updates immediately, then syncs to server
- **Conflict Resolution**: ElectricSQL handles data conflicts automatically

### Key Technologies

- **Phoenix.Sync**: Embedded ElectricSQL for real-time data sync
- **@electric-sql/react**: React hooks for shape-based data sync
- **PostgreSQL**: Logical replication for change data capture
- **Vite**: Fast React development and building

### API Endpoints

- `GET /api/health` - Health check
- `GET /shapes/todos` - ElectricSQL shape endpoint for real-time sync
- `GET /api/todos` - Get all todos
- `POST /api/todos` - Create new todo
- `PUT /api/todos/:id` - Update todo
- `DELETE /api/todos/:id` - Delete todo

## 🧪 Testing

```bash
cd phoenix
mix test
```

## 📦 Deployment

The application is designed for single-server deployment in production:

1. Build the React app
2. Copy static files to Phoenix
3. Deploy Phoenix server
4. Configure PostgreSQL with logical replication

## 🎯 Key Benefits

- **No CORS Issues**: Single-origin deployment
- **Real-time**: Instant updates across all clients  
- **Scalable**: PostgreSQL replication handles high loads
- **Developer Friendly**: Hot reload in development
- **Production Ready**: Optimized static assets

## 📚 Learn More

- [ElectricSQL Documentation](https://electric-sql.com/docs)
- [Phoenix Framework](https://phoenixframework.org/)
- [React Documentation](https://react.dev/)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.