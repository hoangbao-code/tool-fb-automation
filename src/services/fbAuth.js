/**
 * Dịch vụ Xác thực và Bóc tách Facebook trực tiếp (Direct HTTP Facebook Service)
 * Hỗ trợ: Đăng nhập Email/SĐT + Password (+ 2FA), Quét nhóm đã tham gia
 */

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * Trình quản lý Cookie Jar đơn giản cho chuỗi request
 */
class CookieJar {
    constructor(initialCookieStr = '') {
        this.cookies = new Map();
        if (initialCookieStr) {
            this.mergeString(initialCookieStr);
        }
    }

    mergeString(cookieStr) {
        if (!cookieStr) return;
        cookieStr.split(';').forEach(part => {
            const [k, ...v] = part.trim().split('=');
            if (k) this.cookies.set(k.trim(), v.join('=').trim());
        });
    }

    mergeResponseHeaders(headers) {
        let setCookies = [];
        if (headers.getSetCookie) {
            setCookies = headers.getSetCookie();
        } else if (headers.raw && headers.raw()['set-cookie']) {
            setCookies = headers.raw()['set-cookie'];
        } else {
            const h = headers.get('set-cookie');
            if (h) setCookies = [h];
        }

        for (const cookieItem of setCookies) {
            const mainPart = cookieItem.split(';')[0];
            const [k, ...v] = mainPart.trim().split('=');
            if (k && v.length > 0) {
                const val = v.join('=').trim();
                // Không ghi đè nếu cookie bị xóa (deleted)
                if (val && val !== 'deleted' && val !== '""') {
                    this.cookies.set(k.trim(), val);
                }
            }
        }
    }

    toCookieHeader() {
        return Array.from(this.cookies.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    get(name) {
        return this.cookies.get(name);
    }
}

/**
 * Bóc tách các thẻ input từ HTML
 */
function extractFormInputs(html) {
    const inputs = {};
    const regex = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        inputs[match[1]] = match[2];
    }
    // Tìm form action nếu có
    const actionMatch = html.match(/<form[^>]*action=["']([^"']+)["'][^>]*>/i);
    const action = actionMatch ? actionMatch[1] : '';
    return { inputs, action };
}

/**
 * Đăng nhập Facebook bằng Email/SĐT + Password (+ 2FA)
 */
async function loginToFacebook({ email, password, twoFactorCode = '' }) {
    if (!email || !password) {
        return { success: false, message: 'Vui lòng nhập đầy đủ Email/SĐT và Mật khẩu Facebook!' };
    }

    const cleanEmail = email.trim();
    const cleanPass = password.trim();
    const jar = new CookieJar();

    try {
        // Bước 1: GET trang đăng nhập mbasic.facebook.com để lấy token bảo mật ban đầu
        const loginUrl = 'https://mbasic.facebook.com/login.php?refsrc=deprecated&lwv=100';
        const initResp = await fetch(loginUrl, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8'
            },
            redirect: 'manual'
        });

        jar.mergeResponseHeaders(initResp.headers);
        const initHtml = await initResp.text();
        const { inputs, action } = extractFormInputs(initHtml);

        // Chuẩn bị payload form đăng nhập
        const postUrl = action 
            ? (action.startsWith('http') ? action : `https://mbasic.facebook.com${action}`)
            : 'https://mbasic.facebook.com/login/device-based/regular/login/?refsrc=deprecated&lwv=100';

        const formData = new URLSearchParams();
        // Nạp tất cả hidden inputs từ form
        for (const [k, v] of Object.entries(inputs)) {
            if (k !== 'email' && k !== 'pass') {
                formData.append(k, v);
            }
        }
        formData.set('email', cleanEmail);
        formData.set('pass', cleanPass);
        formData.set('login', 'Đăng nhập');

        // Bước 2: POST thông tin đăng nhập
        const loginPostResp = await fetch(postUrl, {
            method: 'POST',
            headers: {
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': jar.toCookieHeader(),
                'Referer': loginUrl,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            body: formData.toString(),
            redirect: 'manual'
        });

        jar.mergeResponseHeaders(loginPostResp.headers);
        let redirectLocation = loginPostResp.headers.get('location') || '';
        let postHtml = '';
        if (loginPostResp.status === 200) {
            postHtml = await loginPostResp.text();
        }

        // Bước 3: Kiểm tra nếu đã nhận được cookie c_user và xs (Đăng nhập thành công trực tiếp)
        let cUser = jar.get('c_user');
        let xs = jar.get('xs');

        if (cUser && xs) {
            const cookieStr = jar.toCookieHeader();
            return {
                success: true,
                cookies: cookieStr,
                uid: cUser,
                name: `Facebook UID: ${cUser}`
            };
        }

        // Bước 4: Nếu có redirect sang checkpoint hoặc trang tiếp theo
        if (redirectLocation) {
            const nextUrl = redirectLocation.startsWith('http') ? redirectLocation : `https://mbasic.facebook.com${redirectLocation}`;
            const checkpointResp = await fetch(nextUrl, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Cookie': jar.toCookieHeader(),
                    'Referer': postUrl
                },
                redirect: 'follow'
            });

            jar.mergeResponseHeaders(checkpointResp.headers);
            cUser = jar.get('c_user');
            xs = jar.get('xs');

            if (cUser && xs) {
                return {
                    success: true,
                    cookies: jar.toCookieHeader(),
                    uid: cUser,
                    name: `Facebook UID: ${cUser}`
                };
            }

            const checkpointHtml = await checkpointResp.text();

            // Kiểm tra xem có phải checkpoint 2FA không
            const is2FA = checkpointHtml.includes('approvals_code') || 
                          checkpointHtml.includes('two_step_verification') ||
                          checkpointHtml.includes('xác thực 2 yếu tố') ||
                          checkpointHtml.includes('mã đăng nhập');

            if (is2FA) {
                // Nếu người dùng ĐÃ nhập mã 2FA, gửi mã 2FA lên
                if (twoFactorCode && twoFactorCode.trim()) {
                    const clean2FA = twoFactorCode.trim().replace(/\s+/g, '');
                    const cpInputs = extractFormInputs(checkpointHtml);
                    const cpAction = cpInputs.action 
                        ? (cpInputs.action.startsWith('http') ? cpInputs.action : `https://mbasic.facebook.com${cpInputs.action}`)
                        : nextUrl;

                    const cpFormData = new URLSearchParams();
                    for (const [k, v] of Object.entries(cpInputs.inputs)) {
                        if (k !== 'approvals_code') cpFormData.append(k, v);
                    }
                    cpFormData.set('approvals_code', clean2FA);
                    cpFormData.set('submit[Submit Code]', 'Gửi mã');

                    const submit2FAResp = await fetch(cpAction, {
                        method: 'POST',
                        headers: {
                            'User-Agent': USER_AGENT,
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Cookie': jar.toCookieHeader(),
                            'Referer': nextUrl
                        },
                        body: cpFormData.toString(),
                        redirect: 'follow'
                    });

                    jar.mergeResponseHeaders(submit2FAResp.headers);
                    cUser = jar.get('c_user');
                    xs = jar.get('xs');

                    if (cUser && xs) {
                        return {
                            success: true,
                            cookies: jar.toCookieHeader(),
                            uid: cUser,
                            name: `Facebook UID: ${cUser}`
                        };
                    }
                    return { success: false, message: 'Mã xác thực 2FA không chính xác hoặc đã hết hạn. Vui lòng thử lại!' };
                }

                // Nếu CHƯA nhập mã 2FA, yêu cầu người dùng nhập mã 2FA
                return {
                    success: false,
                    require2FA: true,
                    message: 'Tài khoản Facebook của bạn đã bật bảo mật 2 lớp (2FA). Vui lòng nhập mã 6 số (từ ứng dụng Authenticator hoặc tin nhắn SMS) để tiếp tục!'
                };
            }

            // Kiểm tra mật khẩu sai
            if (checkpointHtml.includes('không chính xác') || checkpointHtml.includes('incorrect password')) {
                return { success: false, message: 'Mật khẩu Facebook không chính xác! Vui lòng kiểm tra lại.' };
            }
        }

        // Kiểm tra lỗi trong trường hợp không redirect
        if (postHtml.includes('không chính xác') || postHtml.includes('incorrect password')) {
            return { success: false, message: 'Mật khẩu Facebook không chính xác! Vui lòng kiểm tra lại.' };
        }

        return {
            success: false,
            message: 'Không thể đăng nhập tự động vào Facebook lúc này (Facebook yêu cầu xác minh bảo mật hoặc mã Captcha). Bạn có thể dùng tùy chọn "Dán Cookie" để kết nối ngay lập tức.'
        };

    } catch (e) {
        return {
            success: false,
            message: `Lỗi kết nối Facebook: ${e.message}`
        };
    }
}

/**
 * Quét danh sách nhóm Facebook đã tham gia từ Cookies
 */
async function fetchUserJoinedFbGroups(cookiesString) {
    if (!cookiesString || typeof cookiesString !== 'string' || cookiesString.trim().length < 10) {
        throw new Error('Chưa có phiên đăng nhập Facebook hoặc cookie không hợp lệ!');
    }

    const jar = new CookieJar(cookiesString.trim());
    const harvestedGroups = [];
    const seenUrls = new Set();

    let targetUrl = 'https://mbasic.facebook.com/groups/?seemore';
    let maxPages = 8;
    let page = 0;

    const excludedIds = [
        'feed', 'discover', 'notifications', 'joins', 'create', 'search',
        'your_groups', 'membership_questions', 'manage', 'chats', 'member',
        'members', 'buy_sell_discussion', 'permalink', 'user', 'about',
        'events', 'media', 'files', 'tagged', 'post', 'posts'
    ];

    while (targetUrl && page < maxPages) {
        page++;
        try {
            const resp = await fetch(targetUrl, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Cookie': jar.toCookieHeader(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8'
                },
                redirect: 'follow'
            });

            if (resp.url.includes('/login') || resp.url.includes('checkpoint')) {
                throw new Error('Phiên đăng nhập Facebook đã hết hạn. Vui lòng đăng nhập lại tài khoản Facebook!');
            }

            const html = await resp.text();

            // Tìm tất cả liên kết /groups/
            const linkRegex = /<a[^>]+href=["'](\/groups\/([^/?#"'>]+)[^"']*)["'][^>]*>(.*?)<\/a>/gis;
            let match;
            while ((match = linkRegex.exec(html)) !== null) {
                const rawHref = match[1];
                const groupId = match[2];
                const innerHtml = match[3];

                if (!groupId || excludedIds.includes(groupId.toLowerCase())) continue;

                // Làm sạch tên nhóm từ HTML
                const cleanName = innerHtml
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&#039;/g, "'")
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (!cleanName || cleanName.length < 2) continue;
                if (/^(xem tất cả|tạo nhóm|tham gia|rời nhóm|tìm kiếm)/i.test(cleanName)) continue;

                const fullUrl = `https://www.facebook.com/groups/${groupId}/`;
                if (!seenUrls.has(fullUrl)) {
                    seenUrls.add(fullUrl);
                    harvestedGroups.push({
                        groupId: groupId,
                        name: cleanName,
                        url: fullUrl,
                        memberCount: ''
                    });
                }
            }

            // Tìm liên kết "Xem thêm" (See more) để sang trang tiếp theo
            const seeMoreMatch = html.match(/<a[^>]+href=["'](\/groups\/\?seemore[^"']*)["'][^>]*>.*?xem thêm.*?<\/a>/i) ||
                                 html.match(/<a[^>]+href=["'](\/groups\/\?seemore[^"']*)["']/i);

            if (seeMoreMatch && seeMoreMatch[1]) {
                const nextPath = seeMoreMatch[1].replace(/&amp;/g, '&');
                targetUrl = `https://mbasic.facebook.com${nextPath}`;
            } else {
                targetUrl = null;
            }

        } catch (err) {
            if (err.message.includes('hết hạn')) throw err;
            console.error(`Lỗi khi quét trang ${page}:`, err.message);
            break;
        }
    }

    return {
        success: true,
        groups: harvestedGroups,
        total: harvestedGroups.length
    };
}

module.exports = {
    loginToFacebook,
    fetchUserJoinedFbGroups
};
