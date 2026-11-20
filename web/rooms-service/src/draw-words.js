// Word lists for the draw-and-guess game (draw.js), one per language. These are
// plain, common things that can be drawn. The server picks the words, so a player
// never has the list.
const list = (text) => text.split(",").map((w) => w.trim()).filter(Boolean);

export const WORDS = {
    English: list(`
apple, banana, bridge, castle, candle, chair, cloud, clock, crown, dragon, eagle, earth, elephant, engine, feather, fence, finger, flag, flower, forest,
fountain, garden, ghost, giraffe, glasses, guitar, hammer, helmet, island, jacket, jungle, kettle, key, ladder, lantern, lemon, lighthouse, magnet,
mirror, mountain, mushroom, needle, ocean, octopus, orange, panda, parrot, penguin, pillow, pirate, pizza, planet, pumpkin, pyramid, rabbit, rainbow,
robot, rocket, saddle, sandwich, scarf, scissors, shark, shoe, skeleton, snail, snowman, spider, spoon, stairs, submarine, sunflower, sword, table, teapot,
tent, tiger, tomato, tornado, tractor, train, tree, turtle, umbrella, unicorn, vampire, violin, volcano, waterfall, whale, window, wizard, zebra,
airplane, alarm clock, alien, anchor, ant, arrow, avocado, backpack, bacon, bagpipes, balloon, bandage, barn, baseball, basket, bat, battery, beach, bear, bed,
bee, bell, bicycle, bird, blanket, boat, bone, book, boot, bottle, bowl, bread, broom, bucket, bus, butter, butterfly, button, cactus, cake,
camel, camera, campfire, candy, cannon, car, carrot, cat, caterpillar, chain, cheese, cherry, chicken, chimney, circus, clown, coconut, coffee, comb, compass,
computer, cookie, corn, cow, crab, crayon, cricket, crocodile, cupcake, curtain, deer, desert, diamond, dinosaur, doctor, dog, doll, dolphin, donkey, door,
donut, drum, duck, dumbbell, ear, egg, eggplant, envelope, eye, factory, fairy, farm, fire, firefighter, fish, fishing rod, flashlight, flute, fork, fox,
frog, garbage, garlic, gift, goat, golf, grapes, grass, hamburger, hat, heart, hedgehog, helicopter, honey, horse, hospital, hot dog, hourglass, house, ice cream,
igloo, jellyfish, joystick, kangaroo, kite, kitchen, knife, koala, lamp, leaf, light bulb, lightning, lion, lizard, lock, lollipop, mailbox, map, mask, medal,
microphone, milk, monkey, moon, mosquito, motorcycle, mouse, mouth, nail, necklace, nest, nose, nurse, nut, onion, owl, paint, palm tree, pancake, parachute,
peach, pear, pencil, piano, pig, pineapple, pirate ship, plate, plug, police car, popcorn, potato, princess, puzzle, queen, radio, rain, raincoat, ring, river,
road, rollercoaster, rose, sailboat, salad, salt, sand, sausage, scarecrow, school, scorpion, seahorse, seesaw, shark fin, sheep, shell, shield, ship, shirt, shovel,
skateboard, skull, sleeping bag, slide, smoke, snake, snow, soap, sock, sofa, soldier, spaceship, squirrel, stamp, star, starfish, statue, strawberry, sun,
sunglasses, supermarket, swan, sweater, swing, syringe, taxi, telephone, telescope, tennis, thermometer, throne, thunder, ticket, toaster, toilet, tooth, toothbrush,
towel, tower, traffic light, trampoline, treasure, truck, trumpet, tunnel, twins, vase, vegetable, vest, wallet, watch, watermelon, wave, web, wheel, windmill, wing,
witch, wolf, worm, yo-yo, zipper, zombie, beehive, birthday cake, bookshelf, bubble gum, cardboard box, christmas tree, cotton candy, fire truck, flying saucer,
gingerbread man, hot air balloon, ice cube, jack-o-lantern, ladybug, lawn mower, magic wand, merry-go-round, paper plane, picnic, polar bear, rubber duck,
sand castle, school bus, snow globe, space station, swimming pool, tooth fairy, treehouse, washing machine, wedding, yacht, bowling, graveyard, haunted house
`),
    Spanish: list(`
manzana, plátano, puente, castillo, vela, silla, nube, reloj, corona, dragón, águila, tierra, elefante, motor, pluma, valla, dedo, bandera, flor, bosque,
fuente, jardín, fantasma, jirafa, gafas, guitarra, martillo, casco, isla, chaqueta, selva, tetera, llave, escalera, linterna, limón, faro, imán,
espejo, montaña, seta, aguja, océano, pulpo, naranja, panda, loro, pingüino, almohada, pirata, pizza, planeta, calabaza, pirámide, conejo, arcoíris,
robot, cohete, bocadillo, bufanda, tijeras, tiburón, zapato, esqueleto, caracol, muñeco de nieve, araña, cuchara, escalera, submarino, girasol, espada, mesa, tienda de campaña,
tigre, tomate, tornado, tractor, tren, árbol, tortuga, paraguas, unicornio, vampiro, violín, volcán, cascada, ballena, ventana, mago, cebra, avión, ancla, hormiga,
flecha, aguacate, mochila, globo, granja, playa, oso, cama, abeja, campana, bicicleta, pájaro, manta, barco, hueso, libro, bota, botella, pan, escoba,
mariposa, cactus, tarta, camello, cámara, hoguera, caramelo, cañón, coche, zanahoria, gato, queso, cereza, pollo, payaso, coco, café, peine, brújula, ordenador
`),
    French: list(`
pomme, banane, pont, château, bougie, chaise, nuage, horloge, couronne, dragon, aigle, terre, éléphant, moteur, plume, clôture, doigt, drapeau, fleur, forêt,
fontaine, jardin, fantôme, girafe, lunettes, guitare, marteau, casque, île, veste, jungle, bouilloire, clé, échelle, lanterne, citron, phare, aimant,
miroir, montagne, champignon, aiguille, océan, pieuvre, orange, panda, perroquet, pingouin, oreiller, pirate, pizza, planète, citrouille, pyramide, lapin, arc-en-ciel,
robot, fusée, sandwich, écharpe, ciseaux, requin, chaussure, squelette, escargot, bonhomme de neige, araignée, cuillère, escalier, sous-marin, tournesol, épée, table, tente,
tigre, tomate, tornade, tracteur, train, arbre, tortue, parapluie, licorne, vampire, violon, volcan, cascade, baleine, fenêtre, sorcier, zèbre, avion, ancre, fourmi,
flèche, avocat, sac à dos, ballon, ferme, plage, ours, lit, abeille, cloche, vélo, oiseau, couverture, bateau, os, livre, botte, bouteille, pain, balai,
papillon, cactus, gâteau, chameau, appareil photo, feu de camp, bonbon, canon, voiture, carotte, chat, fromage, cerise, poulet, clown, noix de coco, café, peigne, boussole, ordinateur
`),
    German: list(`
Apfel, Banane, Brücke, Schloss, Kerze, Stuhl, Wolke, Uhr, Krone, Drache, Adler, Erde, Elefant, Motor, Feder, Zaun, Finger, Flagge, Blume, Wald,
Brunnen, Garten, Geist, Giraffe, Brille, Gitarre, Hammer, Helm, Insel, Jacke, Dschungel, Wasserkocher, Schlüssel, Leiter, Laterne, Zitrone, Leuchtturm, Magnet,
Spiegel, Berg, Pilz, Nadel, Ozean, Krake, Orange, Panda, Papagei, Pinguin, Kissen, Pirat, Pizza, Planet, Kürbis, Pyramide, Hase, Regenbogen,
Roboter, Rakete, Sandwich, Schal, Schere, Hai, Schuh, Skelett, Schnecke, Schneemann, Spinne, Löffel, Treppe, U-Boot, Sonnenblume, Schwert, Tisch, Zelt,
Tiger, Tomate, Tornado, Traktor, Zug, Baum, Schildkröte, Regenschirm, Einhorn, Vampir, Geige, Vulkan, Wasserfall, Wal, Fenster, Zauberer, Zebra, Flugzeug, Anker, Ameise,
Pfeil, Avocado, Rucksack, Ballon, Bauernhof, Strand, Bär, Bett, Biene, Glocke, Fahrrad, Vogel, Decke, Boot, Knochen, Buch, Stiefel, Flasche, Brot, Besen,
Schmetterling, Kaktus, Kuchen, Kamel, Kamera, Lagerfeuer, Bonbon, Kanone, Auto, Karotte, Katze, Käse, Kirsche, Huhn, Clown, Kokosnuss, Kaffee, Kamm, Kompass, Computer
`),
    Portuguese: list(`
maçã, banana, ponte, castelo, vela, cadeira, nuvem, relógio, coroa, dragão, águia, terra, elefante, motor, pena, cerca, dedo, bandeira, flor, floresta,
fonte, jardim, fantasma, girafa, óculos, guitarra, martelo, capacete, ilha, jaqueta, selva, chaleira, chave, escada, lanterna, limão, farol, ímã,
espelho, montanha, cogumelo, agulha, oceano, polvo, laranja, panda, papagaio, pinguim, travesseiro, pirata, pizza, planeta, abóbora, pirâmide, coelho, arco-íris,
robô, foguete, sanduíche, cachecol, tesoura, tubarão, sapato, esqueleto, caracol, boneco de neve, aranha, colher, escadas, submarino, girassol, espada, mesa, barraca,
tigre, tomate, tornado, trator, trem, árvore, tartaruga, guarda-chuva, unicórnio, vampiro, violino, vulcão, cachoeira, baleia, janela, mago, zebra, avião, âncora, formiga,
flecha, abacate, mochila, balão, fazenda, praia, urso, cama, abelha, sino, bicicleta, pássaro, cobertor, barco, osso, livro, bota, garrafa, pão, vassoura,
borboleta, cacto, bolo, camelo, câmera, fogueira, doce, canhão, carro, cenoura, gato, queijo, cereja, frango, palhaço, coco, café, pente, bússola, computador
`),
    Italian: list(`
mela, banana, ponte, castello, candela, sedia, nuvola, orologio, corona, drago, aquila, terra, elefante, motore, piuma, recinto, dito, bandiera, fiore, foresta,
fontana, giardino, fantasma, giraffa, occhiali, chitarra, martello, casco, isola, giacca, giungla, bollitore, chiave, scala, lanterna, limone, faro, magnete,
specchio, montagna, fungo, ago, oceano, polpo, arancia, panda, pappagallo, pinguino, cuscino, pirata, pizza, pianeta, zucca, piramide, coniglio, arcobaleno,
robot, razzo, panino, sciarpa, forbici, squalo, scarpa, scheletro, lumaca, pupazzo di neve, ragno, cucchiaio, scale, sottomarino, girasole, spada, tavolo, tenda,
tigre, pomodoro, tornado, trattore, treno, albero, tartaruga, ombrello, unicorno, vampiro, violino, vulcano, cascata, balena, finestra, mago, zebra, aereo, ancora, formica,
freccia, avocado, zaino, palloncino, fattoria, spiaggia, orso, letto, ape, campana, bicicletta, uccello, coperta, barca, osso, libro, stivale, bottiglia, pane, scopa,
farfalla, cactus, torta, cammello, fotocamera, falò, caramella, cannone, macchina, carota, gatto, formaggio, ciliegia, pollo, pagliaccio, cocco, caffè, pettine, bussola, computer
`),
    Dutch: list(`
appel, banaan, brug, kasteel, kaars, stoel, wolk, klok, kroon, draak, adelaar, aarde, olifant, motor, veer, hek, vinger, vlag, bloem, bos,
fontein, tuin, spook, giraf, bril, gitaar, hamer, helm, eiland, jas, jungle, waterkoker, sleutel, ladder, lantaarn, citroen, vuurtoren, magneet,
spiegel, berg, paddenstoel, naald, oceaan, octopus, sinaasappel, panda, papegaai, pinguïn, kussen, piraat, pizza, planeet, pompoen, piramide, konijn, regenboog,
robot, raket, broodje, sjaal, schaar, haai, schoen, skelet, slak, sneeuwpop, spin, lepel, trap, duikboot, zonnebloem, zwaard, tafel, tent,
tijger, tomaat, tornado, trekker, trein, boom, schildpad, paraplu, eenhoorn, vampier, viool, vulkaan, waterval, walvis, raam, tovenaar, zebra, vliegtuig, anker, mier,
pijl, avocado, rugzak, ballon, boerderij, strand, beer, bed, bij, bel, fiets, vogel, deken, boot, bot, boek, laars, fles, brood, bezem,
vlinder, cactus, taart, kameel, camera, kampvuur, snoep, kanon, auto, wortel, kat, kaas, kers, kip, clown, kokosnoot, koffie, kam, kompas, computer
`),
};

export const LANGUAGES = Object.keys(WORDS);
