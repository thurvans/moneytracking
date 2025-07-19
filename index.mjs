// 📦 Import dan Inisialisasi
import TelegramBot from 'node-telegram-bot-api';
import admin from 'firebase-admin';
import fs from 'fs';
import ExcelJS from 'exceljs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 🔥 Firebase Configuration
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});


const db = admin.database();
const expensesRef = db.ref('expenses');
const limitsRef = db.ref('limits');
const budgetsRef = db.ref('budgets');
const ownersRef = db.ref('owners');
const usersRef = db.ref('users');
const donationsRef = db.ref('donations');

// 🧑‍💻 Bot Configuration
const token = process.env.TELEGRAM_TOKEN;
const ownerId = process.env.OWNER_ID;
const bot = new TelegramBot(token, { polling: true });

// 🔐 Validasi Functions
async function isOwner(chatId) {
  const snapshot = await ownersRef.child(chatId).once('value');
  return snapshot.exists() && snapshot.val().toString() === "true";
}

async function isDonator(chatId) {
  const snapshot = await donationsRef.child(chatId).once('value');
  return snapshot.exists();
}

// 🎯 UI Helper Functions
function backToMenuButton() {
  return {
    reply_markup: {
      keyboard: [[{ text: '⬅️ Kembali ke Menu' }]],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

function formatRupiah(angka) {
  return 'Rp' + angka.toLocaleString('id-ID');
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function getDateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { start, end };
}

// 💬 Menu Utama
async function sendMainMenu(chatId) {
  const menuText = `📊 *MoneyTrack Bot - Menu Utama*\n\nKelola keuangan harianmu dengan mudah!`;
  const isUserOwner = await isOwner(chatId);

  const keyboard = [
    [{ text: '➕ Tambah Pengeluaran' }, { text: '📄 Riwayat' }],
    [{ text: '📊 Laporan Hari Ini' }, { text: '📈 Laporan Mingguan' }],
    [{ text: '📅 Laporan Bulanan' }, { text: '🎯 Set Budget' }],
    [{ text: '🗑️ Hapus Data' }, { text: '📤 Ekspor Excel' }],
    [{ text: '💰 Donasi' }, { text: 'ℹ️ Bantuan' }]
  ];

  if (isUserOwner) keyboard.push([{ text: '🛠 Owner Panel' }]);

  bot.sendMessage(chatId, menuText, {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard,
      resize_keyboard: true
    }
  });
}

// 💵 Donasi QRIS
bot.onText(/\/qris/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendPhoto(chatId, 'qris.jpg', {
    caption: `💰 *Dukung Pengembangan Bot*

Jika bot ini bermanfaat, kamu bisa memberikan donasi untuk mendukung pengembangan lebih lanjut.

💳 Donasi: Seikhlasnya
📱 Scan QRIS di atas lalu kirim ke @gladd2

Terima kasih atas dukunganmu! 🙏`,
    parse_mode: 'Markdown'
  });
});

// 📩 Broadcast (Owner Only)
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const senderId = msg.chat.id;
  if (!(await isOwner(senderId))) {
    return bot.sendMessage(senderId, '❌ Fitur ini hanya untuk owner.');
  }
  
  const message = match[1];
  const snapshot = await usersRef.once('value');
  const users = snapshot.val() || {};
  
  let successCount = 0;
  const userIds = Object.keys(users);
  
  for (const uid of userIds) {
    try {
      await bot.sendMessage(uid, `📢 *Pengumuman*\n\n${message}`, { parse_mode: 'Markdown' });
      successCount++;
    } catch (error) {
      console.error(`Failed to send to ${uid}:`, error.message);
    }
  }
  
  bot.sendMessage(senderId, `✅ Broadcast berhasil dikirim ke ${successCount}/${userIds.length} pengguna.`);
});

// 📈 Statistik Bot (Owner Only)
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  if (!(await isOwner(chatId))) return;
  
  const [userSnap, expenseSnap, donationSnap] = await Promise.all([
    usersRef.once('value'),
    expensesRef.once('value'),
    donationsRef.once('value')
  ]);
  
  const userCount = Object.keys(userSnap.val() || {}).length;
  const expenseCount = Object.keys(expenseSnap.val() || {}).length;
  const donatorCount = Object.keys(donationSnap.val() || {}).length;
  
  bot.sendMessage(chatId, `📊 *Statistik Bot*\n\n👥 Total Pengguna: ${userCount}\n📦 Total Transaksi: ${expenseCount}\n💰 Donatur: ${donatorCount}\n📅 Aktif sejak: ${formatDate(new Date())}`, {
    parse_mode: 'Markdown'
  });
});

// 🛠️ Message Handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'Pengguna';
  
  // Simpan data pengguna
  await usersRef.child(chatId).update({ 
    name,
    last_activity: new Date().toISOString()
  });

  switch (msg.text) {
    case '➕ Tambah Pengeluaran':
      return bot.sendMessage(chatId, `/add untuk menambah pengeluaran`, {
        parse_mode: 'Markdown',
        ...backToMenuButton()
      });
      
    case '📄 Riwayat':
      return sendHistory(chatId);
      
    case '🗑️ Hapus Data':
      return showDeleteOptions(chatId);
      
    case '📊 Laporan Hari Ini':
      return sendDailyReport(chatId);
      
    case '📈 Laporan Mingguan':
      return sendWeeklyReport(chatId);
      
    case '📅 Laporan Bulanan':
      return sendMonthlyReport(chatId);
      
    case '🎯 Set Budget':
      return bot.sendMessage(chatId, `💡 *Format Set Budget:*\n\n\`/budget [jenis] [jumlah]\`\n\n*Jenis Budget:*\n• \`daily\` - Budget harian\n• \`weekly\` - Budget mingguan  \n• \`monthly\` - Budget bulanan\n\n*Contoh:*\n\`/budget daily 100000\`\n\`/budget weekly 500000\`\n\`/budget monthly 2000000\``, {
        parse_mode: 'Markdown',
        ...backToMenuButton()
      });
      
    case '📤 Ekspor Excel':
      return exportExcel(chatId);
      
    case '💰 Donasi':
      return bot.sendMessage(chatId, `💰 *Dukung Pengembangan Bot*\n\nJika bot ini bermanfaat, kamu bisa memberikan donasi untuk mendukung pengembangan lebih lanjut.\n\nKetik \`/qris\` untuk melihat QR code donasi.\n\nTerima kasih! 🙏`, {
        parse_mode: 'Markdown',
        ...backToMenuButton()
      });
      
    case 'ℹ️ Bantuan':
      return sendHelp(chatId);
      
    case '🛠 Owner Panel':
      if (!(await isOwner(chatId))) return bot.sendMessage(chatId, '❌ Fitur ini khusus untuk owner.');
      return showOwnerPanel(chatId);
      
    case '⬅️ Kembali ke Menu':
      return sendMainMenu(chatId);
  }
});

// 📂 Kategori Default
const defaultCategories = [
  'makanan', 'minuman', 'transportasi', 'bensin', 'parkir',
  'belanja', 'kesehatan', 'hiburan', 'pendidikan', 'langganan',
  'donasi', 'zakat', 'investasi', 'kosmetik',
  'perawatan', 'rumah', 'listrik', 'air', 'internet',
  'lainnya'
];

// 🔁 Tambah opsi kategori default saat tambah pengeluaran
bot.onText(/\/add$/, async (msg) => {
  const chatId = msg.chat.id;
  const keyboard = defaultCategories.map(cat => [{ text: cat }]);

  await bot.sendMessage(chatId, `📌 *Langkah Tambah Pengeluaran*

1️⃣ Pilih kategori terlebih dahulu dari daftar di bawah.
2️⃣ Setelah memilih kategori, kamu akan diminta mengetik jumlah & deskripsi.

*Contoh:*
\`15000 Makan siang\`

Selamat mencatat keuanganmu!`, {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: keyboard.concat([[{ text: '⬅️ Kembali ke Menu' }]]),
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });

  // Simpan state pengguna sedang pilih kategori
  await usersRef.child(chatId).update({ state: 'awaiting_category' });
});

// 🚀 Handler input kategori yang dipilih
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userSnap = await usersRef.child(chatId).once('value');
  const userData = userSnap.val() || {};

  if (userData.state === 'awaiting_category' && defaultCategories.includes(text)) {
    await usersRef.child(chatId).update({ state: `awaiting_entry:${text}` });
    return bot.sendMessage(chatId, `✍️ *Tulis pengeluaranmu*\nContoh: \`15000 Makan siang\``, {
      parse_mode: 'Markdown',
      ...backToMenuButton()
    });
  }

  // Jika sedang input jumlah dan deskripsi setelah pilih kategori
  if (userData.state && userData.state.startsWith('awaiting_entry:')) {
    const category = userData.state.split(':')[1];
    const parts = text.trim().split(' ');
    const amount = parseInt(parts[0]);
    const description = parts.slice(1).join(' ');

    if (isNaN(amount) || amount <= 0 || description.length < 2) {
      return bot.sendMessage(chatId, '❌ Format tidak valid. Tulis jumlah dan deskripsi setelah memilih kategori.\nContoh: \`15000 Makan siang\`', {
        parse_mode: 'Markdown',
        ...backToMenuButton()
      });
    }

    const expenseData = {
      amount,
      description,
      category,
      date: new Date().toISOString(),
      created_at: admin.database.ServerValue.TIMESTAMP
    };

    await expensesRef.child(chatId).push(expenseData);
    await usersRef.child(chatId).update({ state: null });

    bot.sendMessage(chatId, `✅ *Pengeluaran Ditambahkan!*\n💰 ${formatRupiah(amount)}\n📝 ${description}\n📂 ${category}`, {
      parse_mode: 'Markdown',
      ...backToMenuButton()
    });

    await checkBudget(chatId);
    return;
  }
});

// 🔁 Kembalikan perintah lama /add dengan teks panduan jika diikuti parameter
bot.onText(/\/add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  return bot.sendMessage(chatId, '📝 *Gunakan fitur kategori default sekarang!*\n\nKetik `/add` lalu pilih kategori, kemudian masukkan nominal dan deskripsi pengeluaran.', {
    parse_mode: 'Markdown',
    ...backToMenuButton()
  });
});


// 🎯 Set Budget
bot.onText(/\/budget (daily|weekly|monthly) (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const type = match[1];
  const amount = parseInt(match[2]);
  
  await budgetsRef.child(chatId).child(type).set({
    amount,
    created_at: admin.database.ServerValue.TIMESTAMP
  });
  
  const typeText = {
    daily: 'Harian',
    weekly: 'Mingguan', 
    monthly: 'Bulanan'
  };
  
  bot.sendMessage(chatId, `✅ Budget ${typeText[type]} berhasil diset ke ${formatRupiah(amount)}`, backToMenuButton());
});

// 🧾 Riwayat Pengeluaran
async function sendHistory(chatId) {
  const snapshot = await expensesRef.child(chatId).once('value');
  const expenses = snapshot.val();
  
  if (!expenses) {
    return bot.sendMessage(chatId, '📭 Belum ada data pengeluaran.', backToMenuButton());
  }
  
  const sortedExpenses = Object.entries(expenses)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 15);
  
  let text = `📄 *Riwayat 15 Pengeluaran Terakhir*\n\n`;
  let totalAmount = 0;
  
  sortedExpenses.forEach((expense, index) => {
    totalAmount += expense.amount;
    const date = new Date(expense.date).toLocaleDateString('id-ID');
    text += `${index + 1}. ${formatRupiah(expense.amount)}\n   📝 ${expense.description}\n   📂 ${expense.category} • 📅 ${date}\n\n`;
  });
  
  text += `💰 *Total: ${formatRupiah(totalAmount)}*`;
  
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...backToMenuButton()
  });
}

// 📊 Laporan Harian
async function sendDailyReport(chatId) {
  const snapshot = await expensesRef.child(chatId).once('value');
  const expenses = snapshot.val();
  
  if (!expenses) {
    return bot.sendMessage(chatId, '📭 Belum ada data pengeluaran hari ini.', backToMenuButton());
  }
  
  const today = new Date().toISOString().slice(0, 10);
  const todayExpenses = Object.values(expenses).filter(expense => 
    expense.date.startsWith(today)
  );
  
  if (todayExpenses.length === 0) {
    return bot.sendMessage(chatId, '📭 Belum ada pengeluaran hari ini.', backToMenuButton());
  }
  
  const totalToday = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const categoryTotals = {};
  
  todayExpenses.forEach(expense => {
    categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
  });
  
  let text = `📊 *Laporan Pengeluaran Hari Ini*\n📅 ${formatDate(new Date())}\n\n`;
  
  // Detail per kategori
  text += `📂 *Pengeluaran per Kategori:*\n`;
  Object.entries(categoryTotals)
    .sort(([,a], [,b]) => b - a)
    .forEach(([category, amount]) => {
      const percentage = ((amount / totalToday) * 100).toFixed(1);
      text += `• ${category}: ${formatRupiah(amount)} (${percentage}%)\n`;
    });
  
  text += `\n💰 *Total Hari Ini: ${formatRupiah(totalToday)}*\n`;
  text += `📝 *Jumlah Transaksi: ${todayExpenses.length}*\n`;
  
  // Cek budget harian
  const budgetSnap = await budgetsRef.child(chatId).child('daily').once('value');
  if (budgetSnap.exists()) {
    const dailyBudget = budgetSnap.val().amount;
    const remaining = dailyBudget - totalToday;
    const percentage = ((totalToday / dailyBudget) * 100).toFixed(1);
    
    text += `\n🎯 *Budget Harian: ${formatRupiah(dailyBudget)}*\n`;
    if (remaining >= 0) {
      text += `✅ *Sisa Budget: ${formatRupiah(remaining)} (${percentage}% terpakai)*`;
    } else {
      text += `❌ *Kelebihan Budget: ${formatRupiah(Math.abs(remaining))} (${percentage}% terpakai)*`;
    }
  }
  
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...backToMenuButton()
  });
}

// 📈 Laporan Mingguan
async function sendWeeklyReport(chatId) {
  const snapshot = await expensesRef.child(chatId).once('value');
  const expenses = snapshot.val();
  
  if (!expenses) {
    return bot.sendMessage(chatId, '📭 Belum ada data pengeluaran minggu ini.', backToMenuButton());
  }
  
  const { start, end } = getDateRange(7);
  const weeklyExpenses = Object.values(expenses).filter(expense => {
    const expenseDate = new Date(expense.date);
    return expenseDate >= start && expenseDate <= end;
  });
  
  if (weeklyExpenses.length === 0) {
    return bot.sendMessage(chatId, '📭 Belum ada pengeluaran minggu ini.', backToMenuButton());
  }
  
  const totalWeekly = weeklyExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const dailyTotals = {};
  const categoryTotals = {};
  
  weeklyExpenses.forEach(expense => {
    const day = expense.date.slice(0, 10);
    dailyTotals[day] = (dailyTotals[day] || 0) + expense.amount;
    categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
  });
  
  let text = `📈 *Laporan Mingguan*\n📅 ${formatDate(start)} - ${formatDate(end)}\n\n`;
  
  // Pengeluaran per hari
  text += `📅 *Pengeluaran per Hari:*\n`;
  Object.entries(dailyTotals)
    .sort(([a], [b]) => b.localeCompare(a))
    .forEach(([day, amount]) => {
      const dayName = new Date(day).toLocaleDateString('id-ID', { weekday: 'long' });
      text += `• ${dayName}: ${formatRupiah(amount)}\n`;
    });
  
  // Top 5 kategori
  text += `\n📂 *Top 5 Kategori:*\n`;
  Object.entries(categoryTotals)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .forEach(([category, amount]) => {
      const percentage = ((amount / totalWeekly) * 100).toFixed(1);
      text += `• ${category}: ${formatRupiah(amount)} (${percentage}%)\n`;
    });
  
  text += `\n💰 *Total Mingguan: ${formatRupiah(totalWeekly)}*\n`;
  text += `📝 *Jumlah Transaksi: ${weeklyExpenses.length}*\n`;
  text += `📊 *Rata-rata per Hari: ${formatRupiah(Math.round(totalWeekly / 7))}*\n`;
  
  // Cek budget mingguan
  const budgetSnap = await budgetsRef.child(chatId).child('weekly').once('value');
  if (budgetSnap.exists()) {
    const weeklyBudget = budgetSnap.val().amount;
    const remaining = weeklyBudget - totalWeekly;
    const percentage = ((totalWeekly / weeklyBudget) * 100).toFixed(1);
    
    text += `\n🎯 *Budget Mingguan: ${formatRupiah(weeklyBudget)}*\n`;
    if (remaining >= 0) {
      text += `✅ *Sisa Budget: ${formatRupiah(remaining)} (${percentage}% terpakai)*`;
    } else {
      text += `❌ *Kelebihan Budget: ${formatRupiah(Math.abs(remaining))} (${percentage}% terpakai)*`;
    }
  }
  
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...backToMenuButton()
  });
}

// 📅 Laporan Bulanan
async function sendMonthlyReport(chatId) {
  const snapshot = await expensesRef.child(chatId).once('value');
  const expenses = snapshot.val();
  
  if (!expenses) {
    return bot.sendMessage(chatId, '📭 Belum ada data pengeluaran bulan ini.', backToMenuButton());
  }
  
  const { start, end } = getDateRange(30);
  const monthlyExpenses = Object.values(expenses).filter(expense => {
    const expenseDate = new Date(expense.date);
    return expenseDate >= start && expenseDate <= end;
  });
  
  if (monthlyExpenses.length === 0) {
    return bot.sendMessage(chatId, '📭 Belum ada pengeluaran bulan ini.', backToMenuButton());
  }
  
  const totalMonthly = monthlyExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const categoryTotals = {};
  const weeklyTotals = {};
  
  monthlyExpenses.forEach(expense => {
    const expenseDate = new Date(expense.date);
    const weekStart = new Date(expenseDate);
    weekStart.setDate(expenseDate.getDate() - expenseDate.getDay());
    const weekKey = weekStart.toISOString().slice(0, 10);
    
    categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
    weeklyTotals[weekKey] = (weeklyTotals[weekKey] || 0) + expense.amount;
  });
  
  let text = `📅 *Laporan Bulanan*\n📅 ${formatDate(start)} - ${formatDate(end)}\n\n`;
  
  // Pengeluaran per minggu
  text += `📊 *Pengeluaran per Minggu:*\n`;
  Object.entries(weeklyTotals)
    .sort(([a], [b]) => b.localeCompare(a))
    .forEach(([week, amount], index) => {
      text += `• Minggu ${index + 1}: ${formatRupiah(amount)}\n`;
    });
  
  // Top kategori
  text += `\n📂 *Kategori Pengeluaran:*\n`;
  Object.entries(categoryTotals)
    .sort(([,a], [,b]) => b - a)
    .forEach(([category, amount]) => {
      const percentage = ((amount / totalMonthly) * 100).toFixed(1);
      text += `• ${category}: ${formatRupiah(amount)} (${percentage}%)\n`;
    });
  
  text += `\n💰 *Total Bulanan: ${formatRupiah(totalMonthly)}*\n`;
  text += `📝 *Jumlah Transaksi: ${monthlyExpenses.length}*\n`;
  text += `📊 *Rata-rata per Hari: ${formatRupiah(Math.round(totalMonthly / 30))}*\n`;
  
  // Cek budget bulanan
  const budgetSnap = await budgetsRef.child(chatId).child('monthly').once('value');
  if (budgetSnap.exists()) {
    const monthlyBudget = budgetSnap.val().amount;
    const remaining = monthlyBudget - totalMonthly;
    const percentage = ((totalMonthly / monthlyBudget) * 100).toFixed(1);
    
    text += `\n🎯 *Budget Bulanan: ${formatRupiah(monthlyBudget)}*\n`;
    if (remaining >= 0) {
      text += `✅ *Sisa Budget: ${formatRupiah(remaining)} (${percentage}% terpakai)*`;
    } else {
      text += `❌ *Kelebihan Budget: ${formatRupiah(Math.abs(remaining))} (${percentage}% terpakai)*`;
    }
  }
  
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...backToMenuButton()
  });
}

// 🗑️ Opsi Hapus Data
function showDeleteOptions(chatId) {
  bot.sendMessage(chatId, '🗑️ *Pilih Data yang Ingin Dihapus:*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗑️ Hapus Hari Ini', callback_data: 'delete_today' }],
        [{ text: '🗑️ Hapus Minggu Ini', callback_data: 'delete_week' }],
        [{ text: '🗑️ Hapus Semua Data', callback_data: 'delete_all' }],
        [{ text: '❌ Batal', callback_data: 'back_to_menu' }]
      ]
    }
  });
}

// 🛠️ Panel Owner
function showOwnerPanel(chatId) {
  bot.sendMessage(chatId, `🛠 *Panel Owner*\n\nPilih aksi yang ingin dilakukan:`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📢 Broadcast', callback_data: 'owner_broadcast' }],
        [{ text: '📊 Statistik Bot', callback_data: 'owner_stats' }],
        [{ text: '💰 Kelola Donatur', callback_data: 'owner_donator' }],
        [{ text: '⬅️ Kembali', callback_data: 'back_to_menu' }]
      ]
    }
  });
}

// ℹ️ Bantuan
function sendHelp(chatId) {
  const helpText = `ℹ️ *Bantuan MoneyTrack Bot*

*🔧 Perintah Utama:*
• \`/add [jumlah] [deskripsi] [kategori]\` - Tambah pengeluaran
• \`/budget [jenis] [jumlah]\` - Set budget (daily/weekly/monthly)
• \`/qris\` - Lihat QR code donasi
• \`/menu\` - Kembali ke menu utama

*📊 Fitur Laporan:*
• Laporan harian dengan breakdown kategori
• Laporan mingguan dengan trend
• Laporan bulanan dengan analisis mendalam
• Ekspor data ke Excel

*🎯 Fitur Budget:*
• Budget harian, mingguan, dan bulanan
• Notifikasi otomatis saat mendekati limit
• Tracking persentase penggunaan budget

*📂 Kategori Umum:*
makanan, transportasi, hiburan, belanja, kesehatan, pendidikan, lainnya

*💡 Tips:*
• Gunakan kategori yang konsisten
• Catat pengeluaran sesegera mungkin
• Review laporan secara berkala
• Set budget yang realistis

Butuh bantuan lebih lanjut? Hubungi @gladd2`;

  bot.sendMessage(chatId, helpText, {
    parse_mode: 'Markdown',
    ...backToMenuButton()
  });
}

// 🚨 Cek Budget
async function checkBudget(chatId) {
  const [expenseSnap, budgetSnap] = await Promise.all([
    expensesRef.child(chatId).once('value'),
    budgetsRef.child(chatId).once('value')
  ]);
  
  const expenses = expenseSnap.val();
  const budgets = budgetSnap.val();
  
  if (!expenses || !budgets) return;
  
  const today = new Date().toISOString().slice(0, 10);
  const todayExpenses = Object.values(expenses).filter(expense => 
    expense.date.startsWith(today)
  );
  
  const totalToday = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  
  // Cek budget harian
  if (budgets.daily) {
    const dailyBudget = budgets.daily.amount;
    const percentage = (totalToday / dailyBudget) * 100;
    
    if (percentage >= 100) {
      bot.sendMessage(chatId, `🚨 *Budget Harian Terlampaui!*\n\n💰 Total hari ini: ${formatRupiah(totalToday)}\n🎯 Budget harian: ${formatRupiah(dailyBudget)}\n❌ Kelebihan: ${formatRupiah(totalToday - dailyBudget)}`, {
        parse_mode: 'Markdown'
      });
    } else if (percentage >= 80) {
      bot.sendMessage(chatId, `⚠️ *Peringatan Budget!*\n\n💰 Total hari ini: ${formatRupiah(totalToday)}\n🎯 Budget harian: ${formatRupiah(dailyBudget)}\n📊 Terpakai: ${percentage.toFixed(1)}%\n💡 Sisa: ${formatRupiah(dailyBudget - totalToday)}`, {
        parse_mode: 'Markdown'
      });
    }
  }
}

// 🧠 Callback Handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  let handled = false;

  switch (data) {
    case 'back_to_menu':
      await sendMainMenu(chatId);
      handled = true;
      break;
      
    case 'delete_today':
      await deleteExpensesByDate(chatId, 'today');
      handled = true;
      break;
      
    case 'delete_week':
      await deleteExpensesByDate(chatId, 'week');
      handled = true;
      break;
      
    case 'delete_all':
      await expensesRef.child(chatId).remove();
      await bot.sendMessage(chatId, '✅ Semua data pengeluaran berhasil dihapus.', backToMenuButton());
      handled = true;
      break;
      
    case 'owner_broadcast':
      await bot.sendMessage(chatId, '📢 *Broadcast Pesan*\n\nGunakan format:\n`/broadcast [pesan yang ingin dikirim]`\n\nContoh:\n`/broadcast Update bot: Fitur baru telah ditambahkan!`', {
        parse_mode: 'Markdown'
      });
      handled = true;
      break;
      
    case 'owner_stats':
      const [users, expenses, donations] = await Promise.all([
        usersRef.once('value'),
        expensesRef.once('value'),
        donationsRef.once('value')
      ]);
      
      const userCount = Object.keys(users.val() || {}).length;
      const expenseCount = Object.keys(expenses.val() || {}).length;
      const donatorCount = Object.keys(donations.val() || {}).length;
      
      // Hitung statistik tambahan
      const activeUsers = Object.values(users.val() || {}).filter(user => {
        const lastActivity = new Date(user.last_activity || 0);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return lastActivity > weekAgo;
      }).length;
      
      await bot.sendMessage(chatId, `📊 *Statistik Detail Bot*\n\n👥 Total Pengguna: ${userCount}\n🟢 Aktif Minggu Ini: ${activeUsers}\n📦 Total Transaksi: ${expenseCount}\n💰 Total Donatur: ${donatorCount}\n📅 Update: ${formatDate(new Date())}`, {
        parse_mode: 'Markdown'
      });
      handled = true;
      break;
      
    case 'owner_donator':
      await bot.sendMessage(chatId, '💰 *Kelola Donatur*\n\nGunakan perintah:\n• `/adddonator [user_id]` - Tambah donatur\n• `/removedonator [user_id]` - Hapus donatur\n• `/listdonator` - Lihat daftar donatur', {
        parse_mode: 'Markdown'
      });
      handled = true;
      break;
      
    default:
      await bot.sendMessage(chatId, '❓ Perintah tidak dikenali.', backToMenuButton());
      handled = true;
      break;
  }

  if (handled) {
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error('Error answering callback query:', error);
    }
  }
});

// 🗑️ Hapus Data Berdasarkan Tanggal
async function deleteExpensesByDate(chatId, period) {
  const snapshot = await expensesRef.child(chatId).once('value');
  const expenses = snapshot.val();
  
  if (!expenses) {
    return bot.sendMessage(chatId, '📭 Tidak ada data untuk dihapus.', backToMenuButton());
  }
  
  let targetDate;
  let periodText;
  
  if (period === 'today') {
    targetDate = new Date().toISOString().slice(0, 10);
    periodText = 'hari ini';
  } else if (period === 'week') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    targetDate = weekAgo.toISOString().slice(0, 10);
    periodText = 'minggu ini';
  }
  
  const expensesToDelete = Object.entries(expenses).filter(([id, expense]) => {
    if (period === 'today') {
      return expense.date.startsWith(targetDate);
    } else if (period === 'week') {
      const expenseDate = new Date(expense.date);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return expenseDate >= weekAgo;
    }
    return false;
  });
  
  if (expensesToDelete.length === 0) {
    return bot.sendMessage(chatId, `📭 Tidak ada data pengeluaran ${periodText}.`, backToMenuButton());
  }
  
  // Hapus data
  const deletePromises = expensesToDelete.map(([id]) => 
    expensesRef.child(chatId).child(id).remove()
  );
  
  await Promise.all(deletePromises);
  
  const totalDeleted = expensesToDelete.reduce((sum, [, expense]) => sum + expense.amount, 0);
  
  bot.sendMessage(chatId, `✅ *Data Berhasil Dihapus*\n\n📊 Jumlah transaksi: ${expensesToDelete.length}\n💰 Total nilai: ${formatRupiah(totalDeleted)}\n📅 Periode: ${periodText}`, {
    parse_mode: 'Markdown',
    ...backToMenuButton()
  });
}

// 🔐 Donatur Management (Owner Only)
bot.onText(/\/adddonator (\d+)/, async (msg, match) => {
  const senderId = msg.chat.id;
  if (!(await isOwner(senderId))) {
    return bot.sendMessage(senderId, '❌ Fitur ini hanya untuk owner.');
  }
  
  const userId = match[1];
  await donationsRef.child(userId).set({
    added_by: senderId,
    date: new Date().toISOString(),
    status: 'active'
  });
  
  bot.sendMessage(senderId, `✅ User ${userId} berhasil ditambahkan sebagai donatur.`);
  
  // Kirim notifikasi ke donatur
  try {
    await bot.sendMessage(userId, '🎉 *Terima Kasih!*\n\nKamu telah terdaftar sebagai donatur MoneyTrack Bot. Terima kasih atas dukunganmu! 💰', {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Failed to notify donator:', error);
  }
});

bot.onText(/\/removedonator (\d+)/, async (msg, match) => {
  const senderId = msg.chat.id;
  if (!(await isOwner(senderId))) {
    return bot.sendMessage(senderId, '❌ Fitur ini hanya untuk owner.');
  }
  
  const userId = match[1];
  await donationsRef.child(userId).remove();
  
  bot.sendMessage(senderId, `✅ User ${userId} berhasil dihapus dari daftar donatur.`);
});

bot.onText(/\/listdonator/, async (msg) => {
  const senderId = msg.chat.id;
  if (!(await isOwner(senderId))) {
    return bot.sendMessage(senderId, '❌ Fitur ini hanya untuk owner.');
  }
  
  const snapshot = await donationsRef.once('value');
  const donators = snapshot.val() || {};
  
  if (Object.keys(donators).length === 0) {
    return bot.sendMessage(senderId, '📭 Belum ada donatur terdaftar.');
  }
  
  let text = '💰 *Daftar Donatur*\n\n';
  Object.entries(donators).forEach(([userId, data], index) => {
    const date = new Date(data.date).toLocaleDateString('id-ID');
    text += `${index + 1}. ID: ${userId}\n   📅 ${date}\n   ✅ ${data.status}\n\n`;
  });
  
  bot.sendMessage(senderId, text, { parse_mode: 'Markdown' });
});

// 📤 Export Excel dengan Fitur Lebih Lengkap
async function exportExcel(chatId) {
  try {
    const [expenseSnap, budgetSnap] = await Promise.all([
      expensesRef.child(chatId).once('value'),
      budgetsRef.child(chatId).once('value')
    ]);

    const expenses = expenseSnap.val();
    const budgets = budgetSnap.val() || {};

    if (!expenses) {
      return bot.sendMessage(chatId, '📭 Belum ada data pengeluaran untuk diekspor.', backToMenuButton());
    }

    const workbook = new ExcelJS.Workbook();
    
    // Sheet 1: Detail Transaksi
    const detailSheet = workbook.addWorksheet('Detail Transaksi');
    
    // Header
    detailSheet.mergeCells('A1:E1');
    detailSheet.getCell('A1').value = 'LAPORAN KEUANGAN DETAIL';
    detailSheet.getCell('A1').font = { bold: true, size: 16 };
    detailSheet.getCell('A1').alignment = { horizontal: 'center' };
    
    detailSheet.getRow(3).values = ['No', 'Tanggal', 'Jumlah', 'Deskripsi', 'Kategori'];
    detailSheet.getRow(3).font = { bold: true };
    detailSheet.getRow(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' }
    };

    const sortedExpenses = Object.values(expenses).sort((a, b) => new Date(a.date) - new Date(b.date));
    let totalAmount = 0;
    
    sortedExpenses.forEach((expense, index) => {
      totalAmount += expense.amount;
      detailSheet.addRow([
        index + 1,
        new Date(expense.date).toLocaleDateString('id-ID'),
        expense.amount,
        expense.description,
        expense.category
      ]);
    });

    // Format kolom jumlah
    detailSheet.getColumn(3).numFmt = '"Rp"#,##0;[Red]"Rp"#,##0';
    
    // Total
    detailSheet.addRow([]);
    const totalRow = detailSheet.addRow(['', 'TOTAL', totalAmount, '', '']);
    totalRow.font = { bold: true };
    totalRow.getCell(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCC00' }
    };

    // Sheet 2: Ringkasan per Kategori
    const categorySheet = workbook.addWorksheet('Ringkasan Kategori');
    
    const categoryTotals = {};
    sortedExpenses.forEach(expense => {
      categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
    });
    
    categorySheet.mergeCells('A1:C1');
    categorySheet.getCell('A1').value = 'RINGKASAN PER KATEGORI';
    categorySheet.getCell('A1').font = { bold: true, size: 16 };
    categorySheet.getCell('A1').alignment = { horizontal: 'center' };
    
    categorySheet.getRow(3).values = ['Kategori', 'Total', 'Persentase'];
    categorySheet.getRow(3).font = { bold: true };
    categorySheet.getRow(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' }
    };
    
    Object.entries(categoryTotals)
      .sort(([,a], [,b]) => b - a)
      .forEach(([category, amount]) => {
        const percentage = ((amount / totalAmount) * 100).toFixed(1);
        categorySheet.addRow([category, amount, `${percentage}%`]);
      });
    
    categorySheet.getColumn(2).numFmt = '"Rp"#,##0;[Red]"Rp"#,##0';

    // Sheet 3: Laporan Bulanan
    const monthlySheet = workbook.addWorksheet('Laporan Bulanan');
    
    const monthlyTotals = {};
    sortedExpenses.forEach(expense => {
      const month = expense.date.slice(0, 7); // YYYY-MM
      monthlyTotals[month] = (monthlyTotals[month] || 0) + expense.amount;
    });
    
    monthlySheet.mergeCells('A1:C1');
    monthlySheet.getCell('A1').value = 'LAPORAN BULANAN';
    monthlySheet.getCell('A1').font = { bold: true, size: 16 };
    monthlySheet.getCell('A1').alignment = { horizontal: 'center' };
    
    monthlySheet.getRow(3).values = ['Bulan', 'Total Pengeluaran', 'Jumlah Transaksi'];
    monthlySheet.getRow(3).font = { bold: true };
    monthlySheet.getRow(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' }
    };
    
    Object.entries(monthlyTotals)
      .sort(([a], [b]) => b.localeCompare(a))
      .forEach(([month, amount]) => {
        const transactionCount = sortedExpenses.filter(e => e.date.startsWith(month)).length;
        const monthName = new Date(month + '-01').toLocaleDateString('id-ID', { 
          year: 'numeric', 
          month: 'long' 
        });
        monthlySheet.addRow([monthName, amount, transactionCount]);
      });
    
    monthlySheet.getColumn(2).numFmt = '"Rp"#,##0;[Red]"Rp"#,##0';

    // Sheet 4: Budget Tracking (jika ada)
    if (Object.keys(budgets).length > 0) {
      const budgetSheet = workbook.addWorksheet('Budget Tracking');
      
      budgetSheet.mergeCells('A1:D1');
      budgetSheet.getCell('A1').value = 'BUDGET TRACKING';
      budgetSheet.getCell('A1').font = { bold: true, size: 16 };
      budgetSheet.getCell('A1').alignment = { horizontal: 'center' };
      
      budgetSheet.getRow(3).values = ['Jenis', 'Budget', 'Terpakai', 'Status'];
      budgetSheet.getRow(3).font = { bold: true };
      budgetSheet.getRow(3).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDDDDDD' }
      };
      
      Object.entries(budgets).forEach(([type, budgetData]) => {
        const budgetAmount = budgetData.amount;
        let usedAmount = 0;
        
        // Hitung penggunaan berdasarkan jenis budget
        if (type === 'daily') {
          const today = new Date().toISOString().slice(0, 10);
          usedAmount = sortedExpenses
            .filter(e => e.date.startsWith(today))
            .reduce((sum, e) => sum + e.amount, 0);
        } else if (type === 'weekly') {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          usedAmount = sortedExpenses
            .filter(e => new Date(e.date) >= weekAgo)
            .reduce((sum, e) => sum + e.amount, 0);
        } else if (type === 'monthly') {
          const monthAgo = new Date();
          monthAgo.setDate(monthAgo.getDate() - 30);
          usedAmount = sortedExpenses
            .filter(e => new Date(e.date) >= monthAgo)
            .reduce((sum, e) => sum + e.amount, 0);
        }
        
        const percentage = ((usedAmount / budgetAmount) * 100).toFixed(1);
        const status = usedAmount > budgetAmount ? 'Terlampaui' : 'Aman';
        
        const typeText = {
          daily: 'Harian',
          weekly: 'Mingguan',
          monthly: 'Bulanan'
        };
        
        budgetSheet.addRow([
          typeText[type],
          budgetAmount,
          `${usedAmount} (${percentage}%)`,
          status
        ]);
      });
      
      budgetSheet.getColumn(2).numFmt = '"Rp"#,##0;[Red]"Rp"#,##0';
    }

    // Auto-size kolom untuk semua sheet
    workbook.worksheets.forEach(sheet => {
      sheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = maxLength < 10 ? 10 : maxLength + 2;
      });
    });

    const fileName = `laporan_keuangan_${chatId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const filePath = path.join(__dirname, fileName);
    
    await workbook.xlsx.writeFile(filePath);

    await bot.sendDocument(chatId, filePath, {
      caption: `📄 *Laporan Keuangan Lengkap*\n\n📊 Total Transaksi: ${sortedExpenses.length}\n💰 Total Pengeluaran: ${formatRupiah(totalAmount)}\n📅 Periode: ${formatDate(new Date(sortedExpenses[0].date))} - ${formatDate(new Date(sortedExpenses[sortedExpenses.length - 1].date))}\n\n*Sheet yang tersedia:*\n• Detail Transaksi\n• Ringkasan Kategori\n• Laporan Bulanan\n${Object.keys(budgets).length > 0 ? '• Budget Tracking' : ''}`,
      parse_mode: 'Markdown'
    }, backToMenuButton());

    // Hapus file setelah dikirim
    fs.unlinkSync(filePath);
    
  } catch (error) {
    console.error('❌ Error saat ekspor Excel:', error);
    bot.sendMessage(chatId, '❌ Terjadi kesalahan saat membuat laporan Excel. Silakan coba lagi.', backToMenuButton());
  }
}

// 🚀 Start Command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'Pengguna';

  // Tambahkan owner otomatis jika chat ID cocok
  if (String(chatId) === ownerId) {
    await ownersRef.child(chatId).set(true);
  }

  const welcomeText = `👋 *Selamat Datang ${name}!*

🎯 *MoneyTrack Bot* - Asisten Keuangan Pintar

✨ *Fitur Unggulan:*
• 📊 Laporan harian, mingguan, dan bulanan
• 🎯 Budget tracking dengan notifikasi
• 📤 Export data ke Excel
• 📈 Analisis pengeluaran per kategori
• 🔔 Peringatan otomatis budget

💡 *Mulai dengan:*
• Ketik /add untuk menambah pengeluaran
• Ketik /menu untuk melihat semua fitur
• Ketik /help untuk panduan lengkap

Selamat mengelola keuangan! 💰`;

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Buka Menu Utama', callback_data: 'back_to_menu' }]
      ]
    }
  });
});

// 📋 Menu Command
bot.onText(/\/menu/, (msg) => sendMainMenu(msg.chat.id));

// 📛 Error Handling
bot.on("polling_error", (error) => {
  console.error("Polling Error:", error.code, error.message);
  
  // Restart bot setelah delay jika error kritis
  if (error.code === 'ETELEGRAM' || error.code === 'EFATAL') {
    console.log('🔄 Restarting bot in 5 seconds...');
    setTimeout(() => {
      process.exit(1);
    }, 5000);
  }
});

// 🎯 Reminder Harian untuk Donatur (Opsional)
setInterval(async () => {
  try {
    const snapshot = await donationsRef.once('value');
    const donators = snapshot.val() || {};
    
    for (const chatId of Object.keys(donators)) {
      try {
        await sendDailyReport(chatId);
      } catch (error) {
        console.error(`Failed to send daily report to ${chatId}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in daily reminder:', error);
  }
}, 1000 * 60 * 60 * 24); // 24 jam

console.log('🤖 MoneyTrack Bot is running...');
console.log('✅ All features loaded successfully');
console.log('📊 Ready to track your expenses!');