const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Настройка сервера
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Настройка Socket.io для связи в реальном времени
const io = new Server(server, {
    cors: {
        origin: "*", // Позже здесь нужно будет указать адрес твоего фронтенда
        methods: ["GET", "POST"]
    }
});

// Простой маршрут для проверки работы сервера
app.get('/api/status', (req, res) => {
    res.json({ status: 'Server is running', version: '1.0.0' });
});

// Логика реального времени (Socket.io)
io.on('connection', (socket) => {
    console.log(`Пользователь подключился: ${socket.id}`);

    // Обработка отключения
    socket.on('disconnect', () => {
        console.log(`Пользователь отключился: ${socket.id}`);
    });
});

// Запуск сервера на порту 3000
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
