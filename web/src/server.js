const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const apiRoutes = require('./routes/api');
const { startPostWorker } = require('./services/fbPoster');
const { dbAsync } = require('./db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cho phép CORS (để Userscript từ chat.zalo.me gửi webhook về mà không bị chặn)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Phục vụ giao diện tĩnh từ thư mục public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Đăng ký các tuyến API
app.use('/api', apiRoutes);

// Khởi chạy Worker kiểm tra hàng đợi bài đăng
startPostWorker();

// Lắng nghe cổng
app.listen(PORT, async () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n==================================================`);
    console.log(`🚀 POSTHUB WEB DASHBOARD ĐÃ KHỞI CHẠY THÀNH CÔNG!`);
    console.log(`👉 Truy cập giao diện: ${url}`);
    console.log(`💬 Zalo Webhook sẵn sàng tại: ${url}/api/zalo/webhook`);
    console.log(`==================================================\n`);

    await dbAsync.log('info', `Hệ thống Web Dashboard đã khởi động tại ${url}`);

    // Tự động mở trình duyệt nếu có tham số --open hoặc môi trường desktop
    if (process.argv.includes('--open')) {
        try {
            const open = (await import('open')).default;
            await open(url);
        } catch (e) {
            console.log('Không thể tự động mở trình duyệt:', e.message);
        }
    }
});
