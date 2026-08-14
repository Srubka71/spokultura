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
    type: "album", // <-- Tutaj podajesz "album"
    title: "Pierwsza edycja RapAir w Oleśnicy",
    subtitle: "Amfiteatr w Oleśnicy • 2026",
    description: "Relacja z wydarzenia RapAir, Spokultura dodała coś od siebie — muzyka, kultura uliczna i ludzie.",
    date: "2026-07-25",
    thumbnail: "assets/thumbnails/media-01.jpg",
    gallery: [
        { type: "video", url: "assets/video/rapair-video1.mp4" },
        { type: "image", url: "assets/images/rapair-01.jpg" },
        { type: "image", url: "assets/images/rapair-02.jpg" },
        { type: "image", url: "assets/images/rapair-03.jpg" },
        { type: "image", url: "assets/images/rapair-04.jpg" }
    ],
 
    id: 2,
    type: "PHOTO", // <-- Tutaj podajesz "album"
    title: "Graffiti Jam by Spokultura Edycja I",
    subtitle: "Osiedle Muchobór Wielki • 2025",
    description: "Pierwszy grafiti jam organizowany pod patronatem Spokultury. Spotkaliśmy się aby stworzyć przestrzeń dla lokalnych artystów, to była jedna z czterech stref na Osiedlowym Festynie z okazji Dnia Dziecka organizowanym przez Osiedle Muchobór Wielki we Wrocławiu. Było gorąco! Chcemy więcej!",
    date: "2026-05-31",
    thumbnail: "assets/thumbnails/Graffiti.png",
    gallery: [
        { type: "image", url: "assets/images/Graffiti1.jpg" },
        { type: "image", url: "assets/images/Graffiti2.jpg" },
        { type: "image", url: "assets/images/Graffiti3.jpg" }
     
    ]},


    {
        id: 3,

        type: "video",

        title: "Breakdance Battle",

        subtitle: "RAPair • 2026",

        description:
            "Najciekawsze momenty rywalizacji i pokazów breakdance.",

        date: "2026-07-25",

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

        image:
            "assets/thumbnails/media-04.jpg"

    }

];
