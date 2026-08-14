/*
=========================================================
 SPOKULTURA MEDIA — KONFIGURACJA
=========================================================

 Tutaj dodajesz wszystkie materiały.

 type:
    "photo" — zdjęcie
    "video" — film

 title:
    główny tytuł

 subtitle:
    podtytuł / nazwa wydarzenia / lokalizacja

 description:
    opis materiału

 date:
    data materiału w formacie YYYY-MM-DD

 rating:
    ocena od 0 do 5

 image:
    zdjęcie główne / zdjęcie materiału

 thumbnail:
    miniatura filmu

 videoUrl:
    link do filmu — YouTube / Vimeo / bezpośredni plik

=========================================================
*/


const MEDIA_ITEMS = [

    {
        id: 1,

        type: "video",

        title: "Spokultura Jam Night",

        subtitle: "Wrocław • 2026",

        description:
            "Relacja z wydarzenia Spokultury — muzyka, kultura uliczna i ludzie.",

        date: "2026-08-10",

        rating: 5.0,

        thumbnail:
            "assets/thumbnails/media-01.jpg",

        videoUrl:
            "https://www.youtube.com/watch?v=TU_WKLEJ_FILM"

    },


    {
        id: 2,

        type: "photo",

        title: "Graffiti Session",

        subtitle: "Street Art • 2026",

        description:
            "Fotorelacja z malowania i spotkania artystów związanych ze sceną graffiti.",

        date: "2026-08-05",

        rating: 4.8,

        image:
            "assets/thumbnails/media-02.jpg"

    },


    {
        id: 3,

        type: "video",

        title: "Breakdance Battle",

        subtitle: "RAPair • 2026",

        description:
            "Najciekawsze momenty rywalizacji i pokazów breakdance.",

        date: "2026-07-25",

        rating: 4.9,

        thumbnail:
            "assets/thumbnails/media-03.jpg",

        videoUrl:
            "https://www.youtube.com/watch?v=TU_WKLEJ_FILM"

    },


    {
        id: 4,

        type: "photo",

        title: "RAPair Festival",

        subtitle: "Oleśnica • 2026",

        description:
            "Zdjęcia z pierwszej edycji wydarzenia RAPair — rap, graffiti, breakdance i kultura uliczna.",

        date: "2026-07-25",

        rating: 4.7,

        image:
            "assets/thumbnails/media-04.jpg"

    }

];