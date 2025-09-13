#!/bin/bash

echo "🚀 Phoenix + Electric + React Todo App"
echo "======================================"

# Check if we're in the right directory
if [ ! -d "phoenix" ] || [ ! -d "frontend" ]; then
    echo "❌ Error: Must run from the project root directory"
    echo "   Expected to find 'phoenix/' and 'frontend/' directories"
    exit 1
fi

echo ""
echo "📁 Project Structure:"
echo "   phoenix/  - Phoenix backend with ElectricSQL"
echo "   frontend/ - React frontend"
echo ""

echo "Choose how to run the application:"
echo "1) 🚀 Production mode - Single Phoenix server (serves React + API)"
echo "2) 🔧 Development mode - Separate frontend/backend servers (with CORS)"
echo ""
read -p "Enter choice (1-2): " choice

case $choice in
    1)
        echo ""
        echo "🔧 Building React app for production..."
        cd frontend
        VITE_SERVER_URL=/api VITE_ELECTRIC_URL=http://localhost:4000 npm run build
        
        echo "📦 Copying build to Phoenix static directory..."
        cp -r dist/* ../phoenix/priv/static/
        
        cd ../phoenix
        echo ""
        echo "🎯 Starting Phoenix server (serves React app + API)..."
        echo "📍 Application: http://localhost:4000"
        echo ""
        echo "💡 Press Ctrl+C to stop the server"
        echo ""
        
        mix phx.server
        ;;
    2)
        echo ""
        echo "🔧 Installing concurrently for development mode..."
        cd frontend
        npm install --no-save concurrently
        
        echo ""
        echo "🎯 Starting development servers with CORS support..."
        echo "📍 Backend (API + Electric):  http://localhost:4000"
        echo "📍 Frontend (React dev):     http://localhost:5173"
        echo ""
        echo "💡 Use http://localhost:5173 for development (hot reload)"
        echo "💡 CORS is configured to allow cross-origin requests"
        echo "💡 Press Ctrl+C to stop both servers"
        echo ""
        
        # Set environment variables for development mode
        export VITE_SERVER_URL=http://localhost:4000/api
        export VITE_ELECTRIC_URL=http://localhost:4000
        
        npx concurrently \
            --names "Phoenix,React" \
            --prefix-colors "blue,green" \
            --kill-others-on-fail \
            "cd ../phoenix && mix phx.server" \
            "VITE_SERVER_URL=http://localhost:4000/api VITE_ELECTRIC_URL=http://localhost:4000 npm run dev"
        ;;
    *)
        echo "❌ Invalid choice. Use 1 or 2"
        exit 1
        ;;
esac 