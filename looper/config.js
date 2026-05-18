const TOTAL_SLOTS = 36;

const beats = [
  {
    id: 1,
    title: "Dark Bounce",
    producer: "Unknown",
    bpm: 78,
    file: "assets/audio/beat1.mp3",
    image: "assets/images/beat1.jpg",
    available: true
  },
  {
    id: 2,
    title: "Drill Night",
    producer: "Unknown",
    bpm: 95,
    file: "assets/audio/beat2.mp3",
    image: "assets/images/beat2.jpg",
    available: true
  },
  {
    id: 3,
    title: "Drill Night 2",
    producer: "Unknown",
    bpm: 86,
    file: "assets/audio/beat3.mp3",
    image: "assets/images/beat3.jpg",
    available: true
  },
  {
    id: 4,
    title: "Sick (!) ",
    producer: "Unknown",
    bpm: 93,
    file: "assets/audio/beat4.mp3",
    image: "assets/images/beat4.jpg",
    available: true
  },
   {
    id: 5,
    title: "Three for free",
    producer: "Unknown",
    bpm: 91,
    file: "assets/audio/beat5.mp3",
    image: "assets/images/beat5.jpg",
    available: true
  },
  {
    id: 6,
    title: "Lambada",
    producer: "Unknown",
    bpm: 60,
    file: "assets/audio/beat6.mp3",
    image: "assets/images/beat6.jpg",
    available: true
  },
   {
    id: 7,
    title: "Dunno",
    producer: "Unknown",
    bpm: 105,
    file: "assets/audio/beat7.mp3",
    image: "assets/images/beat7.png",
    available: true
  },
   {
    id: 8,
    title: "I dont want to",
    producer: "Unknown",
    bpm: 98,
    file: "assets/audio/beat8.mp3",
    image: "assets/images/beat8.png",
    available: true
  },
   {
    id: 9,
    title: "Lucky Seven",
    producer: "Unknown",
    bpm: 93,
    file: "assets/audio/beat9.mp3",
    image: "assets/images/beat9.jpg",
    available: true
  },
   {
    id: 10,
    title: "Desert",
    producer: "Unknown",
    bpm: 93,
    file: "assets/audio/beat10.mp3",
    image: "assets/images/beat10.jpg",
    available: true
  },
   {
    id: 11,
    title: "Who?",
    producer: "Unknown",
    bpm: 87,
    file: "assets/audio/beat11.mp3",
    image: "assets/images/beat23.jpeg",
    available: true
  },
   {
    id: 12,
    title: "Breakdance for ever",
    producer: "Twister",
    bpm: 90,
    file: "assets/audio/beat12.mp3",
    image: "assets/images/beat12.png",
    available: true
  },
   {
    id: 13 ,
    title: "Nie inaczej",
    producer: "Twister",
    bpm: 92.2,
    file: "assets/audio/beat13.mp3",
    image: "assets/images/beat13.png",
    available: true
  },
   {
    id: 14,
    title: "Nowy",
    producer: "Twister",
    bpm: 80,
    file: "assets/audio/beat14.mp3",
    image: "assets/images/beat14.png",
    available: true
  },
   {
    id: 15,
    title: "Osiedlowe refleksje",
    producer: "Twister",
    bpm: 90,
    file: "assets/audio/beat15.mp3",
    image: "assets/images/beat15.png",
    available: true
  },
   {
    id: 16,
    title: "Zrozum",
    producer: "Twister",
    bpm: 90,
    file: "assets/audio/beat16.mp3",
    image: "assets/images/beat16.png",
    available: true
  },
     {
    id: 17,
    title: "Unknown",
    producer: "DC BELL",
    bpm: 90,
    file: "assets/audio/beat17.mp3",
    image: "assets/images/beat17.jpg",
    available: true
  },
       {
    id: 18,
    title: "Watch Out",
    producer: "Unknown",
    bpm: 88,
    file: "assets/audio/beat18.mp3",
    image: "assets/images/beat18.jpeg",
    available: true
  },
       {
    id: 19,
    title: "King Kong",
    producer: "Unknown",
    bpm: 76,
    file: "assets/audio/beat19.mp3",
    image: "assets/images/beat19.jpeg",
    available: true
  },
       {
    id: 20,
    title: "Dark side",
    producer: "Unknown",
    bpm: 82.90,
    file: "assets/audio/beat20.mp3",
    image: "assets/images/beat20.jpeg",
    available: true
  },
       {
    id: 21,
    title: "Six feet",
    producer: "Unknown",
    bpm: 104,
    file: "assets/audio/beat21.mp3",
    image: "assets/images/beat21.jpeg",
    available: true
  },
       {
    id: 22,
    title: "The Squad",
    producer: "Unknown  ",
    bpm: 97,
    file: "assets/audio/beat22.mp3",
    image: "assets/images/beat22.jpeg",
    available: true
  },
       {
    id: 23,
    title: "Blinder",
    producer: "Unknown",
    bpm: 103,
    file: "assets/audio/beat23.mp3",
    image: "assets/images/beat11.jpg",
    available: true
  },
       {
    id: 24,
    title: "Vandals",
    producer: "Unknown",
    bpm: 102,
    file: "assets/audio/beat24.mp3",
    image: "assets/images/beat24.jpeg",
    available: true
  },
       {
    id: 25,
    title: "Gotcha",
    producer: "Unknown",
    bpm: 96,
    file: "assets/audio/beat25.mp3",
    image: "assets/images/beat25.jpeg",
    available: true
  },
       {
    id: 26,
    title: "Boomboozled",
    producer: "Unknown",
    bpm: 89,
    file: "assets/audio/beat26.mp3",
    image: "assets/images/beat26.jpeg",
    available: true
  },
       {
    id: 27,
    title: "Burning bars",
    producer: "Unknown",
    bpm: 68,
    file: "assets/audio/beat27.mp3",
    image: "assets/images/beat27.jpeg",
    available: true
  },
       {
    id: 28,
    title: "Gloomy",
    producer: "Unknown",
    bpm: 95,
    file: "assets/audio/beat28.mp3",
    image: "assets/images/beat28.jpeg",
    available: true
  },
       {
    id: 29,
    title: "Grim",
    producer: "Unknown",
    bpm: 88,
    file: "assets/audio/beat29.mp3",
    image: "assets/images/beat29.jpeg",
    available: true
  },
       {
    id: 30,
    title: "No fear",
    producer: "Unknown",
    bpm: 88,
    file: "assets/audio/beat30.mp3",
    image: "assets/images/beat30.jpeg",
    available: true
  },
       {
    id: 31,
    title: "Fr13ay",
    producer: "Unknown",
    bpm: 97,
    file: "assets/audio/beat31.mp3",
    image: "assets/images/beat31.jpeg",
    available: true
  },
       {
    id: 32,
    title: "Balance",
    producer: "Unknown",
    bpm: 78,
    file: "assets/audio/beat32.mp3",
    image: "assets/images/beat32.jpeg",
    available: true
  },
       {
    id: 33,
    title: "Broke",
    producer: "Unknown",
    bpm: 93,
    file: "assets/audio/beat33.mp3",
    image: "assets/images/beat33.jpeg",
    available: true
  },
       {
    id: 34,
    title: "Corleone",
    producer: "Unknown",
    bpm: 95,
    file: "assets/audio/beat34.mp3",
    image: "assets/images/beat34.jpeg",
    available: true
  },
       {
    id: 35,
    title: "Mediatate",
    producer: "Unknown",
    bpm: 85,
    file: "assets/audio/beat35.mp3",
    image: "assets/images/beat35.jpeg",
    available: true
  },
       {
    id: 36,
    title: "Inmate",
    producer: "Unknown",
    bpm: 87,
    file: "assets/audio/beat36.mp3",
    image: "assets/images/beat36.jpeg",
    available: true
  },
]
