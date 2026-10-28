/**
 * Converts Devanagari script (Hindi STT output for Urdu speakers) into clean,
 * natural Pakistani Roman Urdu / English and authentic Urdu Script (اردو),
 * so Hindi/Devanagari never appears in transcripts or dashboard.
 */

// Common whole-word Pakistani address/name/phrase dictionary for clean Roman Urdu
const DICTIONARY_ROMAN = {
  // Conversational & Greetings
  "नमस्ते": "Hello",
  "नमस्कार": "Hello",
  "प्रणाम": "Assalam-o-Alaikum",
  "सलाम": "Salam",
  "अस्सलाम": "Assalam",
  "अस्सलाम अलैकुम": "Assalam-o-Alaikum",
  "अस्सलाम वालेकुम": "Assalam-o-Alaikum",
  "वालेकुम अस्सलाम": "Walaikum Assalam",
  "शुक्रिया": "Shukriya",
  "धन्यवाद": "Shukriya",
  "स्वागत": "Khushamdeed",
  "सुस्वागतम": "Khushamdeed",
  "अलविदा": "Alvida",
  "बाय": "Bye",
  "टाटा": "Bye",
  "हाँ": "Haan",
  "हां": "Haan",
  "जी": "Ji",
  "जी हाँ": "Ji haan",
  "जी हां": "Ji haan",
  "नहीं": "Nahi",
  "नही": "Nahi",
  "जी नहीं": "Ji nahi",
  "ठीक है": "Theek hai",
  "अच्छा": "Acha",
  "अच्छी": "Achi",
  "बहुत अच्छा": "Bohat acha",
  "बहुत खूब": "Bohat khoob",
  "सुनो": "Suno",
  "बताओ": "Batao",
  "बताइए": "Bataiye",
  "बताइये": "Bataiye",
  "दीजिए": "Dijiye",
  "दीजिये": "Dijiye",
  "लीजिए": "Lijiye",
  "लीजिये": "Lijiye",
  "करिए": "Kariye",
  "कीजिए": "Kijiye",
  "कीजिये": "Kijiye",
  "कर": "Kar",
  "सकती": "Sakti",
  "सकता": "Sakta",
  "सकते": "Sakte",
  "हूँ": "Hoon",
  "हूं": "Hoon",
  "है": "Hai",
  "हैं": "Hain",
  "हो": "Ho",
  "था": "Tha",
  "थी": "Thee",
  "थे": "The",
  "यह": "Yeh",
  "वह": "Woh",
  "ये": "Yeh",
  "वो": "Woh",
  "इस": "Is",
  "उस": "Us",
  "इन": "In",
  "उन": "Un",
  "का": "Ka",
  "की": "Ki",
  "के": "Ke",
  "को": "Ko",
  "से": "Se",
  "पर": "Par",
  "में": "Mein",
  "मैं": "Main",
  "और": "Aur",
  "या": "Ya",
  "भी": "Bhi",
  "तो": "Toh",
  "ही": "Hi",
  "कोई": "Koi",
  "कुछ": "Kuch",
  "सब": "Sab",
  "साहब": "Sahab",
  "जनाब": "Janab",
  "भाई": "Bhai",
  "क्या": "Kya",
  "कहाँ": "Kahan",
  "कहा": "Kaha",
  "कब": "Kab",
  "क्यों": "Kyun",
  "कैसे": "Kaise",
  "कौन": "Kaun",
  "कितना": "Kitna",
  "कितने": "Kitne",
  "कितनी": "Kitni",
  "मुझे": "Mujhe",
  "हमें": "Hamein",
  "आपको": "Aapko",
  "आपका": "Aapka",
  "आपकी": "Aapki",
  "आपके": "Aapke",
  "मेरा": "Mera",
  "मेरी": "Meri",
  "मेरे": "Mere",
  "हमारा": "Hamara",
  "हमारी": "Hamari",
  "हमारे": "Hamare",
  "चाहिए": "Chahiye",
  "पसंद": "Pasand",
  "मदद": "Madad",
  "बात": "Baat",
  "बोल": "Bol",
  "रही": "Rahi",
  "रहा": "Raha",
  "रहे": "Rahe",
  "खाना": "Khana",
  "पीना": "Peena",

  // Restaurant & Ordering Terms
  "ऑर्डर": "Order",
  "आर्डर": "Order",
  "दर्ज": "Darj",
  "कुल": "Kul",
  "रकम": "Raqam",
  "रुपये": "Rupay",
  "रुपए": "Rupay",
  "रुपया": "Rupiya",
  "पैसा": "Paisa",
  "पैसे": "Paise",
  "बिल": "Bill",
  "बर्गर": "Burger",
  "पिज्जा": "Pizza",
  "पिज़्ज़ा": "Pizza",
  "डील": "Deal",
  "चिकन": "Chicken",
  "बीफ": "Beef",
  "मटन": "Mutton",
  "कबाब": "Kabab",
  "बिरयानी": "Biryani",
  "रोटी": "Roti",
  "नान": "Naan",
  "फ्राइज": "Fries",
  "ड्रिंक": "Drink",
  "कोल्ड ड्रिंक": "Cold Drink",
  "सॉस": "Sauce",
  "चीज": "Cheese",
  "डिलीवरी": "Delivery",
  "पिकअप": "Pickup",
  "पता": "Pata",
  "घर": "Ghar",
  "नाम": "Naam",
  "फोन": "Phone",
  "फ़ोन": "Phone",
  "मोबाइल": "Mobile",
  "नंबर": "Number",
  "नम्बर": "Number",
  "रॉयल": "Royal",
  "रेस्टोरेंट": "Restaurant",
  "रेस्तरां": "Restaurant",
  "टेबल": "Table",
  "रिजर्व": "Reserve",
  "रिजर्वेशन": "Reservation",
  "बुकिंग": "Booking",
  "मेहमान": "Mehmaan",
  "लोग": "Log",
  "अफ़राद": "Afraad",
  "अफराद": "Afraad",
  "आज": "Aaj",
  "कल": "Kal",
  "शाम": "Shaam",
  "रात": "Raat",
  "दोपहर": "Dopehar",
  "सुबह": "Subah",
  "बजे": "Baje",
  "वक्त": "Waqt",
  "वक़्त": "Waqt",
  "मिनट": "Minute",
  "घंटे": "Ghante",
  "घंटा": "Ghanta",
  "सेकंड": "Second",

  // Table reservation & time terms
  "तारीख": "Tareekh",
  "तारीख़": "Tareekh",
  "राब्ता": "Raabta",
  "राबता": "Raabta",
  "महफ़ूज़": "Mehfooz",
  "महफूज": "Mehfooz",
  "मदद": "Madad",
  "हाफ़िज़": "Hafiz",
  "हाफिज": "Hafiz",
  "अल्लाह": "Allah",

  // Months
  "जनवरी": "January",
  "फ़रवरी": "February",
  "फरवरी": "February",
  "मार्च": "March",
  "अप्रैल": "April",
  "अप्रेल": "April",
  "मई": "May",
  "जून": "June",
  "जुलाई": "July",
  "अगस्त": "August",
  "सितंबर": "September",
  "सितम्बर": "September",
  "अक्टूबर": "Aktoobar",
  "अक्तूबर": "Aktoobar",
  "नवंबर": "November",
  "नवम्बर": "November",
  "दिसंबर": "December",
  "दिसम्बर": "December",

  // Numbers
  "एक": "1",
  "दो": "2",
  "तीन": "3",
  "चार": "4",
  "पांच": "5",
  "पाँच": "5",
  "छह": "6",
  "छः": "6",
  "सात": "7",
  "आठ": "8",
  "नौ": "9",
  "दस": "10",
  "ग्यारह": "11",
  "बारह": "12",
  "तेरह": "13",
  "चौदह": "14",
  "पंद्रह": "15",
  "सोलह": "16",
  "सत्रह": "17",
  "अठारह": "18",
  "उन्नीस": "19",
  "बीस": "20",
  "तीस": "30",
  "चालीस": "40",
  "पचास": "50",
  "साठ": "60",
  "सत्तर": "70",
  "अस्सी": "80",
  "नब्बे": "90",
  "सौ": "Sau",
  "हजार": "Hazaar",
  "हज़ार": "Hazaar",
  "लाख": "Lakh",

  // Sizes
  "छोटा": "Chota",
  "छोटी": "Choti",
  "दरमियाना": "Darmiyana",
  "दरमियानी": "Darmiyani",
  "बड़ा": "Bara",
  "बड़ी": "Bari",
  "लार्ज": "Large",
  "मीडियम": "Medium",
  "स्मॉल": "Small",

  // Cities & Towns
  "लाहौर": "Lahore",
  "कराची": "Karachi",
  "इस्लामाबाद": "Islamabad",
  "रावलपिंडी": "Rawalpindi",
  "फैसलाबाद": "Faisalabad",
  "मुल्तान": "Multan",
  "पेशावर": "Peshawar",
  "गुजरांवाला": "Gujranwala",
  "सियालकोट": "Sialkot",
  "टाउन": "Town",
  "मॉडल टाउन": "Model Town",
  "इक़बाल टाउन": "Iqbal Town",
  "इकबाल टाउन": "Iqbal Town",
  "जोहर टाउन": "Johar Town",
  "जौहर टाउन": "Johar Town",
  "गुलबर्ग": "Gulberg",
  "डीएचए": "DHA",
  "डिफेंस": "Defence",
  "कैंट": "Cantt",
  "सदर": "Saddar",
  "मॉल": "Mall",
  "बाजार": "Bazaar",
  "मार्केट": "Market",

  // Address terms
  "गली": "Gali",
  "रोड": "Road",
  "स्ट्रीट": "Street",
  "हाउस": "House",
  "मकान": "House",
  "ब्लॉक": "Block",
  "सेक्टर": "Sector",
  "फेज": "Phase",
  "फ्लोर": "Floor",
  "फ्लैट": "Flat",
  "अपार्टमेंट": "Apartment",
  "प्लाजा": "Plaza",
  "मेन": "Main",
  "पास": "Near",
  "के पास": "Near",
  "सामने": "Opposite",
  "नजदीक": "Near",

  // Common Names
  "अहमद": "Ahmad",
  "अहमैद": "Ahmad",
  "मोहम्मद": "Muhammad",
  "मुहम्मद": "Muhammad",
  "अली": "Ali",
  "उमर": "Umar",
  "उस्मान": "Usman",
  "खान": "Khan",
  "मलिक": "Malik",
  "चौधरी": "Chaudhry",
  "बट": "Butt",
  "शेख": "Sheikh",
  "हुसैन": "Hussain",
  "हसन": "Hassan",
  "बिलाल": "Bilal",
  "हम्जा": "Hamza",
  "हमज़ा": "Hamza",
  "जैन": "Zain",
  "तफैल": "Tufail",
  "अबु बकर": "Abu Bakr",
  "अबू बकर": "Abu Bakr",
  "शहजाद": "Shahzad",
  "शाहिद": "Shahid",
  "तारिक": "Tariq",
  "काशिफ": "Kashif",
  "फारूक": "Farooq",
  "रिजवान": "Rizwan",
  "सलमान": "Salman",
  "इरफान": "Irfan",
  "इमरान": "Imran",
  "बाबर": "Babar",
  "अकबर": "Akbar",
  "साकिब": "Saqib",
  "आसिफ": "Asif",
  "आमिर": "Aamir",
  "शाहजेब": "Shahzeb",
};

// Common word dictionary for authentic Urdu Script (اردو رسم الخط)
const DICTIONARY_URDU = {
  "नमस्ते": "السلام علیکم",
  "नमस्कार": "ہیلو",
  "प्रणाम": "السلام علیکم",
  "सलाम": "سلام",
  "अस्सलाम": "السلام",
  "अस्सलाम अलैकुम": "السلام علیکم",
  "अस्सलाम वालेकुम": "السلام علیکم",
  "वालेकुम अस्सलाम": "وعلیکم السلام",
  "शुक्रिया": "شکریہ",
  "धन्यवाद": "شکریہ",
  "स्वागत": "خوش آمدید",
  "सुस्वागतम": "خوش آمدید",
  "अलविदा": "الوداع",
  "बाय": "بائے",
  "हाँ": "ہاں",
  "हां": "ہاں",
  "जी": "جی",
  "जी हाँ": "جی ہاں",
  "जी हां": "جی ہاں",
  "नहीं": "نہیں",
  "नही": "نہیں",
  "जी नहीं": "جی نہیں",
  "ठीक है": "ٹھیک ہے",
  "अच्छा": "اچھا",
  "अच्छी": "اچھی",
  "बहुत अच्छा": "بہت اچھا",
  "बहुत खूब": "بہت خوب",
  "सुनो": "سنو",
  "बताओ": "بتاؤ",
  "बताइए": "بتائیے",
  "बताइये": "بتائیے",
  "दीजिए": "دیجیے",
  "दीजिये": "دیجیے",
  "लीजिए": "لیجیے",
  "लीजिये": "لیجیے",
  "करिए": "کریے",
  "कीजिए": "کیجیے",
  "कीजिये": "کیجیے",
  "कर": "کر",
  "सकती": "سکتی",
  "सकता": "سکتا",
  "सकते": "سکتے",
  "हूँ": "ہوں",
  "हूं": "ہوں",
  "है": "ہے",
  "हैं": "ہیں",
  "हो": "ہو",
  "था": "تھا",
  "थी": "تھی",
  "थे": "تھے",
  "यह": "یہ",
  "वह": "وہ",
  "ये": "یہ",
  "वो": "وہ",
  "इस": "اس",
  "उस": "اس",
  "इन": "ان",
  "उन": "ان",
  "का": "کا",
  "की": "کی",
  "के": "کے",
  "को": "کو",
  "से": "سے",
  "पर": "پر",
  "में": "میں",
  "मैं": "میں",
  "और": "اور",
  "या": "یا",
  "भी": "بھی",
  "तो": "تو",
  "ही": "ہی",
  "कोई": "کوئی",
  "कुछ": "کچھ",
  "सब": "سب",
  "साहब": "صاحب",
  "जनाब": "جناب",
  "भाई": "بھائی",
  "क्या": "کیا",
  "कहाँ": "کہاں",
  "कब": "کب",
  "क्यों": "کیوں",
  "कैसे": "کیسے",
  "कौन": "کون",
  "कितना": "کتنا",
  "कितने": "کتنے",
  "कितनी": "کتنی",
  "मुझे": "مجھے",
  "हमें": "ہمیں",
  "आपको": "آپ کو",
  "आपका": "آپ کا",
  "आपकी": "آپ کی",
  "आपके": "آپ کے",
  "मेरा": "میرا",
  "मेरी": "میری",
  "मेरे": "میرے",
  "हमारा": "ہمارا",
  "हमारी": "ہماری",
  "हमारे": "ہمارے",
  "चाहिए": "چاہیے",
  "पसंद": "پسند",
  "मदद": "مدد",
  "बात": "بات",
  "बोल": "بول",
  "रही": "رہی",
  "रहा": "رہا",
  "रहे": "رہے",
  "खाना": "کھانا",
  "पीना": "پینا",

  "ऑर्डर": "آرڈر",
  "आर्डर": "آرڈر",
  "दर्ज": "درج",
  "कुल": "کل",
  "रकम": "رقم",
  "रुपये": "روپے",
  "रुपए": "روپے",
  "रुपया": "روپیہ",
  "पैसा": "پیسہ",
  "पैसे": "پیسے",
  "बिल": "بل",
  "बर्गर": "برگر",
  "पिज्जा": "پیزا",
  "पिज़्ज़ा": "پیزا",
  "डील": "ڈیل",
  "चिकन": "چکن",
  "बीफ": "بیف",
  "मटन": "مٹن",
  "कबाब": "کباب",
  "बिरयानी": "بریانی",
  "रोटी": "روٹی",
  "नान": "نان",
  "फ्राइज": "فرائز",
  "ड्रिंक": "ڈرنک",
  "कोल्ड ड्रिंक": "کولڈ ڈرنک",
  "सॉस": "سوس",
  "चीज": "چیز",
  "डिलीवरी": "ڈیلیوری",
  "पिकअप": "پک اپ",
  "पता": "پتہ",
  "घर": "گھر",
  "नाम": "نام",
  "फोन": "فون",
  "फ़ोन": "فون",
  "मोबाइल": "موبائل",
  "नंबर": "نمبر",
  "नम्बर": "نمبر",
  "रॉयल": "رائل",
  "रेस्टोरेंट": "ریسٹورنٹ",
  "रेस्तरां": "ریسٹورنٹ",
  "टेबल": "ٹیبل",
  "रिजर्व": "ریزرو",
  "रिजर्वेशन": "ریزرویشن",
  "बुकिंग": "بکنگ",
  "मेहमान": "مہمان",
  "लोग": "لوگ",
  "अफ़राद": "افراد",
  "अफराद": "افراد",
  "आज": "آج",
  "कल": "کل",
  "शाम": "شام",
  "रात": "رات",
  "दोपहर": "دوپہر",
  "सुबह": "صبح",
  "बजे": "بجے",
  "वक्त": "وقت",
  "वक़्त": "وقت",
  "मिनट": "منٹ",
  "घंटे": "گھنٹے",
  "घंटा": "گھنٹہ",
  "सेकंड": "سیکنڈ",

  "एक": "ایک",
  "दो": "دو",
  "तीन": "تین",
  "चार": "چار",
  "पांच": "پانچ",
  "पाँच": "پانچ",
  "छह": "چھ",
  "सात": "سات",
  "आठ": "آٹھ",
  "नौ": "نو",
  "दस": "دس",
  "बीस": "بیس",
  "पचास": "پچاس",
  "सौ": "سو",
  "हजार": "ہزار",
  "हज़ार": "ہزار",
  "लाख": "لاکھ",

  "छोटा": "چھوٹا",
  "छोटी": "چھوٹی",
  "दरमियाना": "درمیانہ",
  "दरमियानी": "درمیانی",
  "बड़ा": "بڑا",
  "बड़ी": "بڑی",

  "लाहौर": "لاہور",
  "कराची": "کراچی",
  "इस्लामाबाद": "اسلام آباد",
  "रावलपिंडी": "راولپنڈی",
  "फैसलाबाद": "فیصل آباد",
  "मुल्तान": "ملتان",
  "पेशावर": "پشاور",
  "टाउन": "ٹاؤن",
  "गुलबर्ग": "گلبرگ",
  "डीएचए": "ڈی ایچ اے",
  "डिफेंस": "ڈیفنس",
  "कैंट": "کینٹ",
  "गली": "گلی",
  "रोड": "روڈ",
  "स्ट्रीट": "اسٹریٹ",
  "हाउस": "ہاؤس",
  "मकान": "مکان",
  "ब्लॉक": "بلاک",
  "सेक्टर": "سیکٹر",
  "फेज": "فیز",
  "अपार्टमेंट": "اپارٹمنٹ",
  "प्लाजा": "پلازہ",
  "मेन": "مین",
  "पास": "پاس",
  "के पास": "کے پاس",
  "सामने": "سامنے",

  "अहमद": "احمد",
  "मोहम्मद": "محمد",
  "मुहम्मद": "محمد",
  "अली": "علی",
  "उमर": "عمر",
  "उस्मान": "عثمان",
  "खान": "خان",
  "मलिक": "ملک",
  "चौधरी": "چوہدری",
  "बट": "بٹ",
  "शेख": "شیخ",
  "हुसैन": "حسین",
  "हसन": "حسن",
  "बिलाल": "بلال",
  "हमज़ा": "حمزہ",
  "जैन": "زین",
  "तफैल": "طفیل",
  "बाबर": "بابر",
  "अकबर": "اکبر",
};

// Character-by-character phonetic map to Roman Urdu
const VOWELS_ROMAN = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
  "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "O",
};

const MATRAS_ROMAN = {
  "ा": "a", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o",
  "ं": "n", "ँ": "n", "ः": "h", "्": "",
};

const CONSONANTS_ROMAN = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "f", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "w",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  // Nukta characters
  "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f",
};

// Character-by-character phonetic map to Urdu Arabic Script
const VOWELS_URDU = {
  "अ": "ا", "आ": "آ", "इ": "ای", "ई": "ای", "उ": "او", "ऊ": "او",
  "ए": "اے", "ऐ": "ائے", "ओ": "او", "औ": "او", "ऑ": "او",
};

const MATRAS_URDU = {
  "ा": "ا", "ि": "ِ", "ी": "ی", "ु": "ُ", "ू": "و",
  "े": "ے", "ै": "ے", "ो": "و", "ौ": "و", "ॉ": "و",
  "ं": "ں", "ँ": "ں", "ः": "ہ", "्": "",
};

const CONSONANTS_URDU = {
  "क": "ک", "ख": "کھ", "ग": "گ", "घ": "گھ", "ङ": "نگ",
  "च": "چ", "छ": "چھ", "ज": "ج", "झ": "جھ", "ञ": "ن",
  "ट": "ٹ", "ठ": "ٹھ", "ड": "ڈ", "ढ": "ڈھ", "ण": "ن",
  "त": "ت", "थ": "تھ", "द": "د", "ध": "دھ", "न": "ن",
  "प": "پ", "फ": "پھ", "ब": "ب", "भ": "بھ", "म": "م",
  "य": "ی", "र": "ر", "ल": "ل", "व": "و",
  "श": "ش", "ष": "ش", "स": "س", "ह": "ہ",
  // Nukta characters
  "क़": "ق", "ख़": "خ", "ग़": "غ", "ज़": "ز", "ड़": "ڑ", "ढ़": "ڑھ", "फ़": "ف",
};

export function hasDevanagari(text) {
  return /[\u0900-\u097F]/.test(String(text || ""));
}

export function hasUrduScript(text) {
  return /[\u0600-\u06FF]/.test(String(text || ""));
}

export function transliterateDevanagariWord(word) {
  if (!word) return "";
  if (DICTIONARY_ROMAN[word]) return DICTIONARY_ROMAN[word];

  let out = "";
  let i = 0;
  const len = word.length;

  while (i < len) {
    const char = word[i];
    const nextChar = i + 1 < len ? word[i + 1] : "";
    const nukta = nextChar === "़";

    const key = nukta ? char + "़" : char;
    if (nukta) i++;

    if (CONSONANTS_ROMAN[key]) {
      const c = CONSONANTS_ROMAN[key];
      const afterChar = i + 1 < len ? word[i + 1] : "";
      if (MATRAS_ROMAN[afterChar] !== undefined) {
        out += c + MATRAS_ROMAN[afterChar];
        i++;
      } else if (afterChar === "्") {
        out += c;
        i++;
      } else if (i + 1 === len) {
        out += c;
      } else {
        out += c + "a";
      }
    } else if (VOWELS_ROMAN[key]) {
      out += VOWELS_ROMAN[key];
    } else if (MATRAS_ROMAN[key] !== undefined) {
      out += MATRAS_ROMAN[key];
    } else if (char === "।") {
      out += ".";
    } else {
      out += key;
    }
    i++;
  }

  if (out.length > 0) {
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

export function transliterateDevanagariToUrduWord(word) {
  if (!word) return "";
  if (DICTIONARY_URDU[word]) return DICTIONARY_URDU[word];

  let out = "";
  let i = 0;
  const len = word.length;

  while (i < len) {
    const char = word[i];
    const nextChar = i + 1 < len ? word[i + 1] : "";
    const nukta = nextChar === "़";

    const key = nukta ? char + "़" : char;
    if (nukta) i++;

    if (CONSONANTS_URDU[key]) {
      const c = CONSONANTS_URDU[key];
      const afterChar = i + 1 < len ? word[i + 1] : "";
      if (MATRAS_URDU[afterChar] !== undefined) {
        out += c + MATRAS_URDU[afterChar];
        i++;
      } else if (afterChar === "्") {
        out += c;
        i++;
      } else {
        out += c;
      }
    } else if (VOWELS_URDU[key]) {
      out += VOWELS_URDU[key];
    } else if (MATRAS_URDU[key] !== undefined) {
      out += MATRAS_URDU[key];
    } else if (char === "।") {
      out += "۔";
    } else {
      out += key;
    }
    i++;
  }
  return out;
}

const SORTED_ROMAN_KEYS = Object.keys(DICTIONARY_ROMAN).sort((a, b) => b.length - a.length);
const SORTED_URDU_KEYS = Object.keys(DICTIONARY_URDU).sort((a, b) => b.length - a.length);

/**
 * Normalize spacing / punctuation so Roman English and Roman Urdu read cleanly in transcripts.
 */
function polishRomanTranscript(text) {
  return String(text || "")
    .replace(/।/g, ".")
    .replace(/‏/g, "")
    .replace(/\$\s*(\d+)\s*\.\s*(\d+)/g, "Rs$1.$2")
    .replace(/\$\s*(\d+)/g, "Rs$1")
    .replace(/\bDelivery\s+ya\s+pickup\b/gi, "Kya yeh order delivery ke liye hai ya pickup")
    .replace(/\bdelivery\s+or\s+pickup\b/gi, "delivery ya pickup")
    .replace(/\bOrder place kar dun\??\b/gi, "Kya main yeh order confirm kar doon")
    .replace(/\border daraj kar doon\??\b/gi, "order confirm kar doon")
    .replace(/\border darj kar doon\??\b/gi, "order confirm kar doon")
    .replace(/\bHi,\s*I am calling from\b/gi, "Assalam-o-Alaikum, main")
    .replace(/\bHow may I help you\??\b/gi, "Main aapki kya madad kar sakti hoon")
    .replace(/\bExtra\s+CHeese\b/gi, "Extra Cheese")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([,.;!?])([^\s\n])/g, "$1 $2")
    .replace(/ORD-\s+/gi, "ORD-")
    .trim();
}

/**
 * Transliterates Devanagari (Hindi STT) into natural Pakistani Roman Urdu / English,
 * and polishes Latin-script lines so dashboards show proper Roman English or Roman Urdu.
 * Does not invent translations for English — English stays English.
 */
export function cleanUrduText(text) {
  if (!text || typeof text !== "string") return text;

  let s = text;

  if (hasDevanagari(s)) {
    // 1. Replace dictionary phrases sorted by descending length
    for (const hindi of SORTED_ROMAN_KEYS) {
      if (s.includes(hindi)) {
        s = s.split(hindi).join(DICTIONARY_ROMAN[hindi]);
      }
    }

    // 2. Transliterate remaining Devanagari tokens
    s = s.replace(/[\u0900-\u097F]+/g, (match) => {
      return transliterateDevanagariWord(match);
    });
  }

  // Keep authentic Urdu script if present (caller may prefer اردو), but still polish Latin parts
  return polishRomanTranscript(s);
}

/**
 * Converts Devanagari or Roman Urdu into authentic Urdu Script (اردو).
 */
export function toUrduScript(text) {
  if (!text || typeof text !== "string") return text;
  if (hasUrduScript(text) && !hasDevanagari(text)) return text;

  let s = text;
  // 1. Replace dictionary phrases sorted by descending length
  for (const hindi of SORTED_URDU_KEYS) {
    if (s.includes(hindi)) {
      s = s.split(hindi).join(DICTIONARY_URDU[hindi]);
    }
  }

  // 2. Transliterate remaining Devanagari tokens into Urdu
  s = s.replace(/[\u0900-\u097F]+/g, (match) => {
    return transliterateDevanagariToUrduWord(match);
  });

  return s.replace(/।/g, "۔");
}
