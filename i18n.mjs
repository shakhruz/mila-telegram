// Words the bot itself says to people (cards, confirmations, refusals, button answers, pairing) in the person's language.
// Language: the owner's Telegram language_code, remembered from their last message or button press; in a group — the
// language of the person who added the bot; unknown or not in the list — English. Uzbek in the Latin alphabet;
// Chinese waits for a native speaker's check before it goes out (see I18N.md).
// Plain JS, no dependencies: imported by receiver.ts and server.ts.
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export const LANGS = ['en', 'ru', 'uz', 'zh']
// Chinese goes out only after a native speaker's check: until then a Chinese-speaking person gets English.
export const LIVE = ['en', 'ru', 'uz']

/** «ru-RU», «uz» → our code; anything else (and Chinese until checked) → 'en'. */
export function pickLang(code) {
  const c = String(code || '').toLowerCase().slice(0, 2)
  return LIVE.includes(c) ? c : 'en'
}

const W = {
  // modes (labels on buttons, in CHATS.md, in confirmations)
  'mode.all':     { en: '💬 Run the chat', ru: '💬 Вести чат', uz: '💬 Chatni yuritish', zh: '💬 管理群聊' },
  'mode.mention': { en: '🏷 By mention', ru: '🏷 По упоминанию', uz: '🏷 Eslatilganda', zh: '🏷 被提及时' },
  'mode.observe': { en: '👁 Observer', ru: '👁 Наблюдатель', uz: '👁 Kuzatuvchi', zh: '👁 旁观' },
  'mode.owner':   { en: '🙋 Only me', ru: '🙋 Только мне', uz: '🙋 Faqat menga', zh: '🙋 仅限我' },
  'mode.read':    { en: '👁 Listen only', ru: '👁 Только слушать', uz: '👁 Faqat tinglash', zh: '👁 仅收听' },
  'mode.deny':    { en: '❌ Reject', ru: '❌ Отказать', uz: '❌ Rad etish', zh: '❌ 拒绝' },

  // the card to the owner when the bot is added to a group or /channel_join is sent
  'join.card': {
    en: '🔗 Mila was added to the group «{title}». Added by: {who}.\nHow should she work there?\n\n' +
        '💬 Run the chat — reads everyone and replies when needed.\n' +
        '🏷 By mention — sees only messages that address her, from anyone.\n' +
        '👁 Observer — reads everyone for context, replies only when addressed.\n' +
        '🙋 Only me — only you can call her there; other people\'s messages do not reach her.\n\n' +
        'The request is valid for 1 hour.',
    ru: '🔗 Милу добавили в группу «{title}». Добавил: {who}.\nКак ей там работать?\n\n' +
        '💬 Вести чат — читает всех и отвечает, когда нужно.\n' +
        '🏷 По упоминанию — видит только сообщения, где к ней обратились, от любого участника.\n' +
        '👁 Наблюдатель — читает всех для понимания, отвечает только когда к ней обратились.\n' +
        '🙋 Только мне — звать её там можете только вы; сообщения других до неё не доходят.\n\n' +
        'Запрос действует 1 час.',
    uz: '🔗 Mila «{title}» guruhiga qo‘shildi. Qo‘shgan: {who}.\nU yerda qanday ishlasin?\n\n' +
        '💬 Chatni yuritish — hammani o‘qiydi va kerak bo‘lganda javob beradi.\n' +
        '🏷 Eslatilganda — faqat unga murojaat qilingan xabarlarni ko‘radi, istalgan ishtirokchidan.\n' +
        '👁 Kuzatuvchi — tushunish uchun hammani o‘qiydi, faqat murojaat qilinganda javob beradi.\n' +
        '🙋 Faqat menga — u yerda uni faqat siz chaqira olasiz; boshqalarning xabarlari unga yetib bormaydi.\n\n' +
        'So‘rov 1 soat amal qiladi.',
    zh: '🔗 Mila 已被加入群组「{title}」。添加者：{who}。\n她在那里应该如何工作？\n\n' +
        '💬 管理群聊 — 阅读所有人的消息，需要时回复。\n' +
        '🏷 被提及时 — 只看到任何成员对她说的消息。\n' +
        '👁 旁观 — 阅读所有人的消息以了解情况，只在被提及时回复。\n' +
        '🙋 仅限我 — 只有您能在群里呼叫她；其他人的消息不会传给她。\n\n' +
        '请求 1 小时内有效。',
  },
  'join.untitled': { en: 'untitled', ru: 'без названия', uz: 'nomsiz', zh: '未命名' },

  // a stranger writes in a connected group: the owner decides in a private chat whether this person joins the group's team
  'team.ask': {
    en: '{who} writes in «{title}». Mila does not see these messages and does not answer. Add to this group\'s team? Then Mila sees their messages and does what they ask, as for you.',
    ru: '{who} пишет в «{title}». Мила эти сообщения не видит и не отвечает. Добавить в команду этой группы? Тогда Мила будет видеть сообщения и выполнять просьбы, как ваши.',
    uz: '{who} «{title}» guruhida yozmoqda. Mila bu xabarlarni ko‘rmaydi va javob bermaydi. Shu guruh jamoasiga qo‘shilsinmi? Shunda Mila xabarlarni ko‘radi va iltimoslarni sizniki kabi bajaradi.',
    zh: '{who} 在「{title}」中发言。Mila 看不到这些消息，也不回复。加入该群的团队吗？加入后 Mila 会看到其消息并像对你一样执行请求。',
  },
  // the strangers' lane
  'lane.passOn': { en: 'I will pass your question to the owner.', ru: 'Передам ваш вопрос владельцу.', uz: 'Savolingizni egasiga yetkazaman.', zh: '我会把你的问题转告给负责人。' },
  'lane.cap': {
    en: 'Today\'s limit of answers to people in your groups is reached — the rest of the day they get no answer. The limit protects your strangers\' key; it can be raised (LANE_DAY_ALL).',
    ru: 'Сегодняшний предел ответов людям в ваших группах исчерпан — до конца дня они без ответа. Предел бережёт ваш ключ для чужих; его можно поднять (LANE_DAY_ALL).',
    uz: 'Guruhlaringizdagi odamlarga bugungi javoblar chegarasi tugadi — kun oxirigacha ular javobsiz. Chegara begonalar uchun kalitingizni asraydi; uni oshirish mumkin (LANE_DAY_ALL).',
    zh: '今天回复群内其他人的次数已达上限——今天剩余时间将不再回复。此上限用于保护你的外部密钥，可调高（LANE_DAY_ALL）。',
  },
  // a press on the consent proxy's card
  'consent.granted':  { en: '✅ Allowed — doing it.', ru: '✅ Разрешено — выполняю.', uz: '✅ Ruxsat berildi — bajaryapman.', zh: '✅ 已允许——正在执行。' },
  'consent.declined': { en: '❌ Not allowed. Not doing it.', ru: '❌ Не разрешено. Не выполняю.', uz: '❌ Ruxsat berilmadi. Bajarmayman.', zh: '❌ 未允许，不执行。' },
  'consent.stopped':  { en: '⏹ The permission is stopped.', ru: '⏹ Полномочие остановлено.', uz: '⏹ Vakolat to‘xtatildi.', zh: '⏹ 授权已停止。' },
  'consent.ignored':  { en: 'This card is no longer valid.', ru: 'Эта карточка уже не действует.', uz: 'Bu karta endi amal qilmaydi.', zh: '此卡片已失效。' },
  'team.btn.add':  { en: '✅ Add to the team', ru: '✅ В команду', uz: '✅ Jamoaga', zh: '✅ 加入团队' },
  'team.btn.skip': { en: 'Not now', ru: 'Не сейчас', uz: 'Hozir emas', zh: '暂不' },
  'team.btn.del':  { en: 'Remove from the team', ru: 'Убрать из команды', uz: 'Jamoadan chiqarish', zh: '移出团队' },
  'team.added':    { en: '✅ On the team of this group.', ru: '✅ В команде этой группы.', uz: '✅ Shu guruh jamoasida.', zh: '✅ 已加入该群团队。' },
  'team.skipped':  { en: 'Not added. Mila still does not see these messages.', ru: 'Не добавлено. Мила по-прежнему не видит эти сообщения.', uz: 'Qo‘shilmadi. Mila bu xabarlarni hali ham ko‘rmaydi.', zh: '未加入。Mila 仍看不到这些消息。' },
  'team.removed':  { en: 'Removed from the team. Mila no longer sees these messages.', ru: 'Убрано из команды. Мила больше не видит эти сообщения.', uz: 'Jamoadan chiqarildi. Mila endi bu xabarlarni ko‘rmaydi.', zh: '已移出团队。Mila 不再看到这些消息。' },
  'join.sent':     { en: '📨 Request sent to the owner privately. The group is connected only after they approve it there.',
                     ru: '📨 Запрос отправлен владельцу в личку. Группа подключится только после его подтверждения.',
                     uz: '📨 So‘rov egasiga shaxsiy chatda yuborildi. Guruh faqat u tasdiqlagandan keyin ulanadi.',
                     zh: '📨 请求已私信发送给所有者。所有者确认后群组才会连接。' },
  'join.undelivered': { en: '⚠️ Could not reach the owner\'s private chat: the owner should first write to the bot privately, then add it again.',
                        ru: '⚠️ Не удалось написать владельцу в личку: пусть владелец сначала напишет боту в личку, потом добавит его снова.',
                        uz: '⚠️ Egasining shaxsiy chatiga yozib bo‘lmadi: egasi avval botga shaxsiy yozsin, keyin uni qayta qo‘shsin.',
                        zh: '⚠️ 无法私信所有者：请所有者先私信机器人，然后再次添加。' },
  'join.inGroupOnly': { en: '/channel_join works inside the group you want to connect.', ru: '/channel_join работает внутри группы, которую нужно подключить.',
                        uz: '/channel_join ulamoqchi bo‘lgan guruh ichida ishlaydi.', zh: '/channel_join 需要在要连接的群组内使用。' },
  'join.static':   { en: 'Static mode — the allowlist only changes by editing access.json on the host.',
                     ru: 'Статический режим — список доступа меняется только правкой access.json на сервере.',
                     uz: 'Statik rejim — ruxsat ro‘yxati faqat serverdagi access.json orqali o‘zgaradi.', zh: '静态模式 — 访问列表只能在服务器上编辑 access.json 修改。' },
  'join.already':  { en: '🟢 Group is already connected.', ru: '🟢 Группа уже подключена.', uz: '🟢 Guruh allaqachon ulangan.', zh: '🟢 群组已连接。' },
  'join.pending':  { en: 'Request already sent to the owner — waiting for approval in their private chat.',
                     ru: 'Запрос уже у владельца — ждём подтверждения в его личке.', uz: 'So‘rov allaqachon egasida — shaxsiy chatda tasdiq kutilmoqda.',
                     zh: '请求已发送给所有者 — 正在等待其私信确认。' },
  'join.tooMany':  { en: 'Too many open requests — clear them in the private chat and try again.',
                     ru: 'Слишком много открытых запросов — разберите их в личке и попробуйте снова.',
                     uz: 'Ochiq so‘rovlar juda ko‘p — shaxsiy chatda ularni hal qiling va qayta urinib ko‘ring.', zh: '待处理请求过多 — 请在私信中处理后重试。' },
  'join.active':   { en: '🟢 Mila is connected to this chat.', ru: '🟢 Мила подключена к этому чату.', uz: '🟢 Mila ushbu chatga ulandi.', zh: '🟢 Mila 已连接到此聊天。' },
  'join.connected': { en: '✅ Connected: {mode}', ru: '✅ Подключено: {mode}', uz: '✅ Ulandi: {mode}', zh: '✅ 已连接：{mode}' },
  'join.archive': {
    en: 'Mila keeps an archive of this chat; the owner can read it. To have your messages removed, ask the owner.',
    ru: 'Мила ведёт архив переписки этого чата; владелец может его читать. Удалить свои сообщения — по просьбе через владельца.',
    uz: 'Mila bu chat yozishmalari arxivini yuritadi; egasi uni o‘qishi mumkin. Xabarlaringizni o‘chirish — egasi orqali so‘rov bilan.',
    zh: 'Mila 会保存本群聊天记录，群主可以查看。如需删除你的消息，请联系群主。',
  },
  'join.archiveOwner': {
    en: 'In every mode Mila keeps an archive of the chat — everyone\'s messages, the group is told so when it is connected.',
    ru: 'В любом режиме Мила ведёт архив чата — сообщения всех участников; группе об этом скажут при подключении.',
    uz: 'Har qanday rejimda Mila chat arxivini yuritadi — barcha ishtirokchilar xabarlari; ulanganda guruhga bu aytiladi.',
    zh: '无论哪种模式，Mila 都会保存群聊记录（所有成员的消息）；连接时会告知群成员。',
  },
  'join.rejected': { en: '❌ Rejected', ru: '❌ Отказано', uz: '❌ Rad etildi', zh: '❌ 已拒绝' },
  'join.decided':  { en: '⌛️ Already decided by another owner, or the request expired.', ru: '⌛️ Уже решено другим владельцем или запрос истёк.',
                     uz: '⌛️ Boshqa ega allaqachon hal qilgan yoki so‘rov muddati tugagan.', zh: '⌛️ 已由其他所有者处理，或请求已过期。' },
  'join.tellOthers': { en: '✅ Mila is connected to «{title}» — mode: {mode}. Connected by: {who}.', ru: '✅ Мила подключена к «{title}» — режим: {mode}. Подключил: {who}.',
                       uz: '✅ Mila «{title}» ga ulandi — rejim: {mode}. Ulagan: {who}.', zh: '✅ Mila 已连接到「{title}」— 模式：{mode}。连接者：{who}。' },
  'join.notConnected': { en: 'This chat is not connected.', ru: 'Этот чат не подключён.', uz: 'Bu chat ulanmagan.', zh: '此聊天未连接。' },
  'leave.done': { en: 'Disconnected. I no longer read this chat or reply in it.\n\nThe chat card and the log entry are kept. The bot owner can reconnect by adding me again.',
                  ru: 'Отключилась. Больше не читаю этот чат и не отвечаю в нём.\n\nКарточка чата и запись в журнале остаются. Владелец может подключить меня снова, добавив в группу.',
                  uz: 'Uzildim. Endi bu chatni o‘qimayman va unda javob bermayman.\n\nChat kartochkasi va jurnaldagi yozuv saqlanadi. Bot egasi meni qayta qo‘shib, ulashi mumkin.',
                  zh: '已断开。我不再阅读此聊天，也不再回复。\n\n聊天卡片和日志记录会保留。机器人所有者可以重新添加我来连接。' },

  // button answers
  'btn.notFound':   { en: 'Button not found or expired.', ru: 'Кнопка не найдена или устарела.', uz: 'Tugma topilmadi yoki eskirgan.', zh: '按钮不存在或已过期。' },
  'btn.notForYou':  { en: 'This button is not for you.', ru: 'Эта кнопка не для вас.', uz: 'Bu tugma siz uchun emas.', zh: '此按钮不是给您的。' },
  'btn.handled':    { en: 'Already handled.', ru: 'Уже обработано.', uz: 'Allaqachon bajarilgan.', zh: '已处理。' },
  'btn.gotIt':      { en: '✅ Got it', ru: '✅ Принято', uz: '✅ Qabul qilindi', zh: '✅ 已收到' },
  'btn.ownerDmOnly': { en: "Owner's private chat only.", ru: 'Только в личке владельца.', uz: 'Faqat egasining shaxsiy chatida.', zh: '仅限所有者私信。' },
  'btn.notAuthorized': { en: 'Not authorized.', ru: 'Нет прав.', uz: 'Ruxsat yo‘q.', zh: '无权限。' },
  'btn.detailsGone': { en: 'Details no longer available.', ru: 'Подробности больше недоступны.', uz: 'Tafsilotlar endi mavjud emas.', zh: '详情已不可用。' },

  // the tool permission card
  'perm.title':   { en: '🔐 Permission: {tool}', ru: '🔐 Разрешение: {tool}', uz: '🔐 Ruxsat: {tool}', zh: '🔐 权限：{tool}' },
  'perm.more':    { en: 'See more', ru: 'Подробнее', uz: 'Batafsil', zh: '查看详情' },
  'perm.allow':   { en: '✅ Allow', ru: '✅ Разрешить', uz: '✅ Ruxsat berish', zh: '✅ 允许' },
  'perm.deny':    { en: '❌ Deny', ru: '❌ Запретить', uz: '❌ Taqiqlash', zh: '❌ 拒绝' },
  'perm.allowed': { en: '✅ Allowed', ru: '✅ Разрешено', uz: '✅ Ruxsat berildi', zh: '✅ 已允许' },
  'perm.denied':  { en: '❌ Denied', ru: '❌ Запрещено', uz: '❌ Taqiqlandi', zh: '❌ 已拒绝' },

  // the bot's command menu
  'menu.start':  { en: 'Welcome and setup guide', ru: 'Приветствие и как начать', uz: 'Salomlashish va qanday boshlash', zh: '欢迎与入门' },
  'menu.help':   { en: 'What this bot can do', ru: 'Что умеет этот бот', uz: 'Bu bot nima qila oladi', zh: '此机器人能做什么' },
  'menu.status': { en: 'Check your pairing status', ru: 'Проверить связь', uz: 'Ulanishni tekshirish', zh: '查看配对状态' },

  // pairing and commands
  'pair.done':    { en: 'Paired! Say hi to Mila.', ru: 'Готово, вы связаны! Напишите Миле.', uz: 'Tayyor, ulandingiz! Milaga yozing.', zh: '配对完成！和 Mila 打个招呼吧。' },
  'pair.required': { en: 'Pairing required — run in Claude Code:\n\n/telegram:access pair {code}', ru: 'Нужно связать — выполните в Claude Code:\n\n/telegram:access pair {code}',
                     uz: 'Ulash kerak — Claude Code da bajaring:\n\n/telegram:access pair {code}', zh: '需要配对 — 请在 Claude Code 中运行：\n\n/telegram:access pair {code}' },
  'pair.pending': { en: 'Still pending — run in Claude Code:\n\n/telegram:access pair {code}', ru: 'Всё ещё ждём — выполните в Claude Code:\n\n/telegram:access pair {code}',
                    uz: 'Hali kutilmoqda — Claude Code da bajaring:\n\n/telegram:access pair {code}', zh: '仍在等待 — 请在 Claude Code 中运行：\n\n/telegram:access pair {code}' },
  'cmd.start': { en: 'This bot connects Telegram to a Claude Code session.\n\nTo pair:\n1. Write me anything — you will get a 6-character code\n2. In Claude Code: /telegram:access pair <code>\n\nAfter that, messages here reach that session.',
                 ru: 'Этот бот связывает Telegram с сессией Claude Code.\n\nЧтобы связать:\n1. Напишите мне что угодно — придёт код из 6 знаков\n2. В Claude Code: /telegram:access pair <код>\n\nПосле этого сообщения отсюда доходят до сессии.',
                 uz: 'Bu bot Telegram ni Claude Code sessiyasi bilan bog‘laydi.\n\nUlash uchun:\n1. Menga istalgan narsa yozing — 6 belgili kod keladi\n2. Claude Code da: /telegram:access pair <kod>\n\nShundan keyin bu yerdagi xabarlar sessiyaga yetib boradi.',
                 zh: '此机器人将 Telegram 连接到 Claude Code 会话。\n\n配对方法：\n1. 给我发任意消息 — 您会收到 6 位代码\n2. 在 Claude Code 中：/telegram:access pair <代码>\n\n之后，这里的消息会送达该会话。' },
  'cmd.help': { en: 'Messages you send here go to a paired Claude Code session. Text and photos are forwarded; replies and reactions come back.\n\n/start — pairing instructions\n/status — your pairing state',
                ru: 'Сообщения отсюда идут в связанную сессию Claude Code. Текст и фото передаются; ответы и реакции приходят обратно.\n\n/start — как связать\n/status — состояние связи',
                uz: 'Bu yerdan yuborilgan xabarlar ulangan Claude Code sessiyasiga boradi. Matn va rasmlar uzatiladi; javoblar va reaksiyalar qaytadi.\n\n/start — qanday ulash\n/status — ulanish holati',
                zh: '您在这里发送的消息会转到已配对的 Claude Code 会话。文字和照片会被转发；回复和表情会传回。\n\n/start — 配对说明\n/status — 配对状态' },
  'status.paired':  { en: 'Paired as {name}.', ru: 'Связаны как {name}.', uz: '{name} sifatida ulangan.', zh: '已作为 {name} 配对。' },
  'status.pending': { en: 'Pending pairing — run in Claude Code:\n\n/telegram:access pair {code}', ru: 'Связь ждёт — выполните в Claude Code:\n\n/telegram:access pair {code}',
                      uz: 'Ulanish kutilmoqda — Claude Code da bajaring:\n\n/telegram:access pair {code}', zh: '配对待完成 — 请在 Claude Code 中运行：\n\n/telegram:access pair {code}' },
  'status.not':     { en: 'Not paired. Send me a message to get a pairing code.', ru: 'Не связаны. Напишите мне — пришлю код.', uz: 'Ulanmagan. Menga yozing — kod yuboraman.', zh: '未配对。给我发消息即可获得配对代码。' },
  'whoami': { en: 'I am an AI assistant, not a person.\n\nI run on Claude (Anthropic) and I am connected to the working session of this chat\'s owner. I read this chat, reply, and carry out the tasks the owner gives me.\n\nWhat I do not do: decide for people in medical, financial or legal matters — there I prepare a draft and a human sends it.\n\nQuestions or complaints go to the owner of this chat, who is responsible for my work.',
              ru: 'Я ИИ-помощница, не человек.\n\nЯ работаю на Claude (Anthropic) и подключена к рабочей сессии владельца этого чата. Читаю чат, отвечаю и выполняю задачи владельца.\n\nЧего не делаю: не решаю за людей медицинские, финансовые и юридические вопросы — там готовлю черновик, а отправляет человек.\n\nВопросы и жалобы — владельцу этого чата: он отвечает за мою работу.',
              uz: 'Men sun’iy intellekt yordamchisiman, odam emasman.\n\nMen Claude (Anthropic) asosida ishlayman va ushbu chat egasining ish sessiyasiga ulanganman. Chatni o‘qiyman, javob beraman va egasining vazifalarini bajaraman.\n\nNima qilmayman: tibbiy, moliyaviy va huquqiy masalalarda odamlar o‘rniga qaror qabul qilmayman — u yerda qoralama tayyorlayman, yuborishni esa odam qiladi.\n\nSavol va shikoyatlar — ushbu chat egasiga: u mening ishim uchun javobgar.',
              zh: '我是 AI 助手，不是真人。\n\n我基于 Claude（Anthropic）运行，并连接到此聊天所有者的工作会话。我阅读此聊天、回复并完成所有者交给我的任务。\n\n我不做的事：不替人做医疗、财务或法律决定 — 这些情况我只准备草稿，由人来发送。\n\n问题或投诉请联系此聊天的所有者，他对我的工作负责。' },
}

/** The words for key in lang, with {name} filled from vars. A missing language falls back to English. */
export function t(lang, key, vars = {}) {
  const w = W[key]
  if (!w) return key
  let s = w[pickLang(lang)] ?? w.en
  for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v))
  return s
}

export function keys() { return Object.keys(W) }
export function words(key) { return W[key] }

/** language_code of people we heard from: user id → our code, in <stateDir>/langs.json (no other data). */
export function rememberLang(stateDir, userId, code) {
  if (!userId || !code) return
  const file = join(stateDir, 'langs.json')
  let m = {}
  try { m = JSON.parse(readFileSync(file, 'utf8')) } catch {}
  const l = pickLang(code)
  if (m[String(userId)] === l) return
  m[String(userId)] = l
  const tmp = `${file}.${process.pid}.tmp`   // receiver and server write the same file: each its own tmp
  try { writeFileSync(tmp, JSON.stringify(m), { mode: 0o600 }); renameSync(tmp, file) } catch {}
}

export function langOf(stateDir, userId) {
  try { return pickLang(JSON.parse(readFileSync(join(stateDir, 'langs.json'), 'utf8'))[String(userId)]) } catch { return 'en' }
}
