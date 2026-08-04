// ══════════════════════════════════════════════════════════════
// data-generator.js — Generador de datos realistas para simulación
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');

const FIRST_NAMES_M = [
  'Juan', 'Carlos', 'Miguel', 'Luis', 'José', 'Pedro', 'Andrés', 'Diego',
  'Fernando', 'Roberto', 'Ricardo', 'Eduardo', 'Sergio', 'Pablo', 'Jorge',
  'Héctor', 'Óscar', 'Raúl', 'Marco', 'Antonio', 'Manuel', 'Francisco',
  'Alejandro', 'Rafael', 'Gabriel', 'Adrián', 'Daniel', 'Samuel', 'Emiliano',
  'Mateo', 'Santiago', 'Sebastián', 'Nicolás', 'Leonardo', 'Matías', 'Lucas',
  'David', 'Emmanuel', 'Javier', 'Iván', 'Ángel', 'Kevin', 'Cristian',
  'Esteban', 'Julián', 'Mauricio', 'Carlos', 'Víctor', 'Enrique', 'Felipe',
  'Bruno', 'Dante', 'Hugo', 'Isaac', 'Joaquín', 'Lorenzo', 'Maximiliano',
  'Renato', 'Tomás', 'Valentino'
];

const FIRST_NAMES_F = [
  'María', 'Ana', 'Laura', 'Carmen', 'Rosa', 'Lucía', 'Sofía', 'Valentina',
  'Isabella', 'Camila', 'Daniela', 'Gabriela', 'Patricia', 'Elena', 'Andrea',
  'Mónica', 'Claudia', 'Teresa', 'Sandra', 'Paula', 'Natalia', 'Alejandra',
  'Diana', 'Verónica', 'Carolina', 'Lorena', 'Silvia', 'Mariana', 'Adriana',
  'Beatriz', 'Catalina', 'Fernanda', 'Juliana', 'Regina', 'Victoria', 'Amanda',
  'Constanza', 'Emilia', 'Isidora', 'Javiera', 'Magdalena', 'Paloma', 'Pilar',
  'Renata', 'Sara', 'Valeria', 'Ximena', 'Yolanda', 'Zulema', 'Ángela',
  'Brenda', 'Dulce', 'Estefanía', 'Gema', 'Ivonne', 'Karla', 'Leticia'
];

const LAST_NAMES = [
  'García', 'Rodríguez', 'Martínez', 'López', 'Hernández', 'González',
  'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera', 'Gómez',
  'Díaz', 'Cruz', 'Morales', 'Reyes', 'Gutiérrez', 'Ortiz', 'Ramos',
  'Ruiz', 'Vargas', 'Castillo', 'Jiménez', 'Moreno', 'Romero', 'Herrera',
  'Medina', 'Aguilar', 'Vega', 'Castro', 'Mendoza', 'Guerrero', 'Muñoz',
  'Contreras', 'Espinoza', 'Campos', 'Delgado', 'Ávila', 'Ríos', 'Salazar',
  'Valencia', 'Córdoba', 'Montoya', 'Paredes', 'Fuentes', 'Cabrera',
  'Mejía', 'Acosta', 'Ponce', 'Arias', 'Miranda', 'Calderón', 'Peña',
  'Cardona', 'Orozco', 'Quiroz', 'Bautista', 'Vásquez', 'Carrillo',
  'Navarro', 'Molina', 'Trujillo', 'Domínguez', 'Silva', 'Salinas',
  'Villanueva', 'Ibarra', 'Gallegos', 'Tapia', 'Soto', 'Barrera',
  'Leal', 'Rosales', 'Ochoa', 'Padilla', 'Cervantes', 'Aguirre',
  'Sandoval', 'Estrada', 'Velázquez', 'Villarreal', 'Escobar', 'Durán'
];

const DOJO_NAMES = [
  'Dragón de Fuego', 'Tigre de Acero', 'Águila Dorada', 'Lobo del Norte',
  'Fénix Rojo', 'Cobra Negra', 'León Imperial', 'Oso Polar', 'Halcón Guerrero',
  'Pantera Rosa', 'Serpiente Dorada', 'Toro Salvaje', 'Delfín Azul', 'Jaguar Maya',
  'Sakura Dojo', 'Bushido Academy', 'Martial Arts Center', 'Centro de Artes Marciales',
  'Karate Club', 'Dojo del Sol', 'Samurai Academy', 'Ninja Training Center',
  'Guerrero MMA', 'Combat Academy', 'Fuerza y Honor', 'El Cinturón Negro',
  'Academia Oriental', 'Escuela de Artes Marciales del Pacífico', 'Dojo Centroamericano',
  'Torneo Martial Academy'
];

const CITY_COUNTRY_PAIRS = [
  { city: 'Ciudad de Panamá', country: 'Panamá' },
  { city: 'San José', country: 'Costa Rica' },
  { city: 'Bogotá', country: 'Colombia' },
  { city: 'Medellín', country: 'Colombia' },
  { city: 'Ciudad de México', country: 'México' },
  { city: 'Guadalajara', country: 'México' },
  { city: 'Lima', country: 'Perú' },
  { city: 'Buenos Aires', country: 'Argentina' },
  { city: 'Santiago', country: 'Chile' },
  { city: 'Quito', country: 'Ecuador' },
  { city: 'Caracas', country: 'Venezuela' },
  { city: 'La Habana', country: 'Cuba' },
  { city: 'Santo Domingo', country: 'República Dominicana' },
  { city: 'David', country: 'Panamá' },
  { city: 'Colón', country: 'Panamá' },
  { city: 'Tegucigalpa', country: 'Honduras' },
  { city: 'Managua', country: 'Nicaragua' },
  { city: 'San Salvador', country: 'El Salvador' },
  { city: 'Guatemala', country: 'Guatemala' }
];

const RANKS_BY_DISCIPLINE = {
  karate: ['10mo Kyu', '9no Kyu', '8vo Kyu', '7mo Kyu', '6to Kyu', '5to Kyu', '4to Kyu', '3er Kyu', '2do Kyu', '1er Kyu', '1er Dan', '2do Dan', '3er Dan'],
  judo: ['6to Kyu', '5to Kyu', '4to Kyu', '3er Kyu', '2do Kyu', '1er Kyu', '1er Dan', '2do Dan', '3er Dan', '4to Dan', '5to Dan'],
  bjj: ['Blanca', 'Blanca/Gris', 'Gris', 'Gris/Negra', 'Amarilla', 'Amarilla/Negra', 'Naranja', 'Naranja/Negra', 'Verde', 'Verde/Negra', 'Azul', 'Purpura', 'Marron', 'Negra'],
  taekwondo: ['Blanca', 'Amarilla', 'Verde', 'Azul', 'Roja', 'Roja/Negra', 'Poom', 'Negra 1Dan', 'Negra 2Dan', 'Negra 3Dan'],
  kickboxing: ['Blanca', 'Amarilla', 'Naranja', 'Verde', 'Azul', 'Marron', 'Negra'],
  muay_thai: ['Blanca', 'Amarilla', 'Naranja', 'Verde', 'Azul', 'Marron', 'Negra', 'Blanco/Dorado'],
  boxing: ['Novato', 'Principiante', 'Intermedio', 'Avanzado', 'Semi-Pro', 'Profesional'],
  mma: ['Blanca', 'Azul', 'Purpura', 'Marron', 'Negra'],
  aikido: ['6to Kyu', '5to Kyu', '4to Kyu', '3er Kyu', '2do Kyu', '1er Kyu', '1er Dan', '2do Dan', '3er Dan', '4to Dan', '5to Dan'],
  kendo: ['6to Kyu', '5to Kyu', '4to Kyu', '3er Kyu', '2do Kyu', '1er Kyu', '1er Dan', '2do Dan', '3er Dan', '4to Dan', '5to Dan', '6to Dan', '7to Dan']
};

const DISCIPLINE_CODES = ['karate', 'judo', 'bjj', 'taekwondo', 'kickboxing', 'muay_thai', 'boxing', 'mma', 'aikido', 'kendo'];

const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'yappy', 'nequi', 'paypal'];

const TOURNAMENT_MODES = ['Kata', 'Kumite', 'Ambos'];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(n, arr.length));
}

function uuid() {
  return crypto.randomUUID();
}

function randomDate(start, end) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const d = new Date(s + Math.random() * (e - s));
  return d.toISOString().slice(0, 10);
}

function randomTime() {
  const h = String(rand(7, 20)).padStart(2, '0');
  const m = String(pick(['00', '15', '30', '45'])).padStart(2, '0');
  return `${h}:${m}`;
}

function randomPhone() {
  return `+507${rand(6000, 6999)}-${String(rand(1000, 9999))}`;
}

function randomEmail(name) {
  const slug = name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
  const domains = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com'];
  return `${slug}${rand(1, 999)}@${pick(domains)}`;
}

function generateFullName(gender) {
  const fn = gender === 'f' ? pick(FIRST_NAMES_F) : pick(FIRST_NAMES_M);
  const ln1 = pick(LAST_NAMES);
  const ln2 = pick(LAST_NAMES);
  return `${fn} ${ln1} ${ln2}`;
}

function generateUsername(fullName) {
  const parts = fullName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(' ');
  const base = (parts[0].slice(0, 4) + parts[1].slice(0, 4)).replace(/[^a-z]/g, '');
  return `${base}${rand(10, 99)}`;
}

function generatePassword() {
  return `Test${rand(1000, 9999)}@!`;
}

function generateBirthDate(minAge = 5, maxAge = 55) {
  const now = new Date();
  const year = now.getFullYear() - rand(minAge, maxAge);
  const month = String(rand(1, 12)).padStart(2, '0');
  const day = String(rand(1, 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateEstablishmentData(count) {
  const establishments = [];
  const usedNames = new Set();

  for (let i = 0; i < count; i++) {
    let name;
    do {
      name = `Dojo ${pick(DOJO_NAMES)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const loc = pick(CITY_COUNTRY_PAIRS);
    establishments.push({
      name,
      city: loc.city,
      country: loc.country
    });
  }
  return establishments;
}

function generateUserForRole(role, index = 0) {
  const gender = Math.random() > 0.4 ? 'm' : 'f';
  const fullName = generateFullName(gender);
  const username = generateUsername(fullName) + (index > 0 ? index : '');
  const password = generatePassword();
  return { fullName, username, password, role };
}

function generateStudents(count, disciplineCodes) {
  const students = [];
  for (let i = 0; i < count; i++) {
    const gender = Math.random() > 0.35 ? 'm' : 'f';
    const fullName = generateFullName(gender);
    students.push({
      fullName,
      email: Math.random() > 0.3 ? randomEmail(fullName) : null,
      phone: Math.random() > 0.4 ? randomPhone() : null,
      birthDate: generateBirthDate(6, 50),
      disciplineCodes: pickN(disciplineCodes, rand(1, 2)),
      currentRank: null,
      instructorProfileId: null
    });
  }
  return students;
}

function getRanksForDiscipline(code) {
  return RANKS_BY_DISCIPLINE[code] || RANKS_BY_DISCIPLINE['karate'];
}

function getRandomRank(code) {
  const ranks = getRanksForDiscipline(code);
  return pick(ranks.slice(0, Math.ceil(ranks.length * 0.6)));
}

function generateAttendanceStatus() {
  const r = Math.random();
  if (r < 0.70) return 'present';
  if (r < 0.82) return 'late';
  if (r < 0.93) return 'absent';
  return 'excused';
}

function generateEvaluationResult() {
  const score = rand(40, 100);
  return {
    score,
    passed: score >= 60,
    notes: score >= 80 ? 'Excelente desempeño' :
           score >= 60 ? 'Aprobado con observaciones' :
           'Necesita mejorar en varias áreas'
  };
}

module.exports = {
  rand, pick, pickN, uuid, randomDate, randomTime, randomPhone,
  randomEmail, generateFullName, generateUsername, generatePassword,
  generateBirthDate, generateEstablishmentData, generateUserForRole,
  generateStudents, getRanksForDiscipline, getRandomRank,
  generateAttendanceStatus, generateEvaluationResult,
  FIRST_NAMES_M, FIRST_NAMES_F, LAST_NAMES, DOJO_NAMES,
  CITY_COUNTRY_PAIRS, RANKS_BY_DISCIPLINE, DISCIPLINE_CODES,
  PAYMENT_METHODS, TOURNAMENT_MODES
};