import PostalMime from 'postal-mime';

interface Env {
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_CHAT_ID: string;
	TELEGRAM_TOPIC_ID?: string;
	WA_API_URL?: string;
	WA_API_KEY?: string;
	WA_GROUP_ID?: string;
}

export default {
	async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
		const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
		const telegramChatId = env.TELEGRAM_CHAT_ID;
		const telegramTopicId = env.TELEGRAM_TOPIC_ID;

		if (!telegramBotToken || !telegramChatId) {
			console.error('Missing Telegram configuration');
			return;
		}

		try {
			const parser = new PostalMime();
			const email = await parser.parse(message.raw);

			// Check for forwarded content
			const forwarded = parseForwardedMail(email.text || email.html || '');

			// Use original details if available, otherwise fall back to current email headers
			const subject = forwarded.subject || email.subject || '(No Subject)';
			const from = forwarded.from || (email.from ? `${email.from.name} <${email.from.address}>` : '(Unknown Sender)');
			const date = forwarded.date || '';

			// Extract transaction details if available
			const transactionDetails = parseTransactionDetails(email.html || email.text || '');

			let telegramMessage = `📧 *${from}*\n` +
				`*Subject:* ${escapeMarkdown(subject)}\n`;

			if (date) {
				telegramMessage += `*Date:* ${escapeMarkdown(date)}\n`;
			}

			telegramMessage += `\n` +
				`*Detail Transaksi:*\n` +
				`*Status:* ${escapeMarkdown(transactionDetails.status)}\n` +
				`*No Referensi:* ${escapeMarkdown(transactionDetails.noRef)}\n` +
				`*Merchant Tujuan:* ${escapeMarkdown(transactionDetails.merchantTujuan)}\n` +
				`*Tanggal Pembayaran:* ${escapeMarkdown(transactionDetails.tanggalPembayaran)}\n` +
				`*Jumlah:* ${escapeMarkdown(transactionDetails.jumlah)}\n` +
				`*Sumber Dana:* ${escapeMarkdown(transactionDetails.sumberDana)}`;

			await sendToTelegram(telegramBotToken, telegramChatId, telegramMessage, telegramTopicId);

			await sendToWhatsApp(env.WA_API_URL, env.WA_API_KEY, env.WA_GROUP_ID, telegramMessage);

		} catch (error) {
			console.error('Error parsing email or sending to Telegram:', error);
			// Optional: send error notification to Telegram or log it
		}
	}
};

export function parseTransactionDetails(html: string): { 
	status: string, 
	noRef: string, 
	merchantTujuan: string, 
	tanggalPembayaran: string, 
	jumlah: string, 
	sumberDana: string 
} {
	// Defaults
	let status = 'N/A';
	let noRef = 'N/A';
	let merchantTujuan = 'N/A';
	let tanggalPembayaran = 'N/A';
	let jumlah = 'N/A';
	let sumberDana = 'N/A';

	if (!html) return { status, noRef, merchantTujuan, tanggalPembayaran, jumlah, sumberDana };

	// Helper to clean extracted text
	const clean = (text: string) => text.replace(/<[^>]*>/g, '').trim();

	// Status
	const statusMatch = html.match(/Status\s*<\/td>\s*<td[^>]*>\s*<b>\s*(.*?)\s*<\/b>/i);
	if (statusMatch && statusMatch[1]) status = clean(statusMatch[1]);

	// No. Referensi
	const noRefMatch = html.match(/No\.\s*Referensi\s*<\/td>\s*<td[^>]*>\s*<b>\s*(.*?)\s*<\/b>/i);
	if (noRefMatch && noRefMatch[1]) noRef = clean(noRefMatch[1]);

	// Merchant Tujuan
	const merchantMatch = html.match(/Merchant\s*Tujuan\s*<\/td>\s*<td[^>]*>\s*<b>\s*(.*?)\s*<\/b>/i);
	if (merchantMatch && merchantMatch[1]) merchantTujuan = clean(merchantMatch[1]);

	// Tanggal Pembayaran
	const tanggalMatch = html.match(/Tanggal\s*Pembayaran\s*<\/td>\s*<td[^>]*>\s*<[^>]*>\s*(.*?)\s*<\/[^>]*>/i);
	if (tanggalMatch && tanggalMatch[1]) tanggalPembayaran = clean(tanggalMatch[1]);

	// Jumlah
	const jumlahMatch = html.match(/Jumlah\s*<\/td>\s*<td[^>]*>\s*<b[^>]*>\s*(.*?)\s*<\/b>/i);
	if (jumlahMatch && jumlahMatch[1]) jumlah = clean(jumlahMatch[1]);

	// Sumber Dana
	// Matches Sumber Dana</p> ... <h2>NAME</h2> ... <p>ACCOUNT</p>
	const sumberDanaHeadMatch = html.match(/Sumber\s*Dana\s*<\/p>\s*<h2[^>]*>\s*(.*?)\s*<\/h2>\s*<p[^>]*>\s*(.*?)\s*<\/p>/i);
	if (sumberDanaHeadMatch) {
		const name = clean(sumberDanaHeadMatch[1]);
		const account = clean(sumberDanaHeadMatch[2]);
		sumberDana = `${name} - ${account}`;
	}

	return { status, noRef, merchantTujuan, tanggalPembayaran, jumlah, sumberDana };
}

function parseForwardedMail(content: string): { from?: string, subject?: string, date?: string } {
	let from, subject, date;

	// Normalize content to help with matching
	// Replace <br> with newlines
	const normalized = content.replace(/<br\s*\/?>/gi, '\n');

	// Regex for "From" / "Dari" in forwarded block
	const fromMatch = normalized.match(/(?:Dari|From):\s*(.*?)(?:\r?\n|$)/i);
	if (fromMatch && fromMatch[1]) {
		// Remove HTML tags and extra whitespace
		from = fromMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
		// Decode HTML entities (basic ones)
		from = from.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
	}

	// Regex for "Date" / "Tanggal"
	const dateMatch = normalized.match(/(?:Date|Tanggal|Sent):\s*(.*?)(?:\r?\n|$)/i);
	if (dateMatch && dateMatch[1]) {
		date = dateMatch[1].replace(/<[^>]*>/g, '').trim();
	}

	// Regex for "Subject"
	const subjectMatch = normalized.match(/Subject:\s*(.*?)(?:\r?\n|$)/i);
	if (subjectMatch && subjectMatch[1]) {
		subject = subjectMatch[1].replace(/<[^>]*>/g, '').trim();
	}

	return { from, subject, date };
}

async function sendToTelegram(token: string, chatId: string, text: string, topicId?: string) {
	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	const body: { chat_id: string, text: string, parse_mode: string, message_thread_id?: number } = {
		chat_id: chatId,
		text: text,
		parse_mode: 'Markdown'
	};

	if (topicId) {
		const parsedTopicId = Number(topicId);
		if (!Number.isNaN(parsedTopicId)) {
			body.message_thread_id = parsedTopicId;
		}
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error(`Telegram API error: ${response.status} ${response.statusText} - ${errorText}`);
	}
}

function escapeMarkdown(text: string): string {
    if (!text) return '';
	// 'Markdown' (v1) supports *bold*, _italic_, [text](url), `code`, ```pre```
    // We should allow some marks if they are intended, but since we are wrapping values, 
    // it's safest to escape everything that could break the format headers.
    // However, for values like "RP. 10.000", * or _ are rare.
	return text.replace(/[_*`\[]/g, '\\$&');
}


async function sendToWhatsApp(apiUrl: string | undefined, apiKey: string | undefined, groupId: string | undefined, text: string) {
	if (!apiUrl || !apiKey || !groupId) {
		console.error('Missing WhatsApp configuration, skipping');
		return;
	}
	const url = apiUrl.replace(/\/$/, '') + '/api/sendText';
	try {
		const resp = await fetch(url, {
			method: 'POST',
			headers: {
				'accept': 'application/json',
				'X-Api-Key': apiKey,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				chatId: groupId,
				text: text,
				session: 'default',
			}),
		});
		if (!resp.ok) {
			console.error('WhatsApp send failed:', resp.status, await resp.text());
		}
	} catch (error) {
		console.error('Error sending to WhatsApp:', error);
	}
}
