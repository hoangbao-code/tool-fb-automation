// Quản lý các kết nối Server-Sent Events (SSE) để cập nhật giao diện thời gian thực
const clients = new Set();

function addClient(res) {
    clients.add(res);
    res.on('close', () => clients.delete(res));
}

function broadcastEvent(eventName, data) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
        try {
            client.write(payload);
        } catch (e) {
            clients.delete(client);
        }
    }
}

module.exports = { addClient, broadcastEvent };
