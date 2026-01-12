import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Creating Nathan Thrower First Month Training Program...');

  // First, create all the drills
  const drills = await createDrills();
  console.log(`Created ${Object.keys(drills).length} drills`);

  // Create the training program
  const program = await prisma.trainingProgram.create({
    data: {
      title: 'Primer Mes de Entrenamiento',
      description: 'Programa completo de 4 semanas diseñado para desarrollar tu mecánica de lanzamiento, movilidad y fuerza. Incluye trabajo de movilidad, calentamiento pre-lanzamiento, ejercicios mecánicos, programa de tiro progresivo y recuperación.',
      category: 'pitching',
      difficulty: 'intermediate',
      durationWeeks: 4,
      isActive: true,
      isPremium: true,
    },
  });
  console.log(`Created program: ${program.title}`);

  // Create 4 weeks
  for (let weekNum = 1; weekNum <= 4; weekNum++) {
    const week = await prisma.trainingProgramWeek.create({
      data: {
        programId: program.id,
        weekNumber: weekNum,
        title: `Semana ${weekNum}`,
        description: getWeekDescription(weekNum),
      },
    });
    console.log(`Created week ${weekNum}`);

    // Create 7 days for each week
    for (let dayNum = 1; dayNum <= 7; dayNum++) {
      const dayData = getDayData(weekNum, dayNum, drills);

      await prisma.trainingProgramDay.create({
        data: {
          weekId: week.id,
          dayNumber: dayNum,
          title: dayData.title,
          drillIds: dayData.drillIds,
          notes: dayData.notes,
          restDay: dayData.restDay,
        },
      });
    }
    console.log(`Created 7 days for week ${weekNum}`);
  }

  console.log('Training program created successfully!');
}

async function createDrills() {
  const drillsData = [
    // MOBILITY - CADERAS (Hips)
    { id: 'hip-circles', title: 'Hip Circles', description: 'Círculos de cadera para mejorar movilidad', category: 'mobility', tags: ['caderas', 'warmup'] },
    { id: 'hip-flexor-stretch', title: 'Hip Flexor Stretch', description: 'Estiramiento de flexores de cadera', category: 'mobility', tags: ['caderas', 'stretch'] },
    { id: '90-90-stretch', title: '90/90 Hip Stretch', description: 'Estiramiento 90/90 para rotación de cadera', category: 'mobility', tags: ['caderas', 'stretch'] },
    { id: 'hip-cars', title: 'Hip CARs', description: 'Rotaciones articulares controladas de cadera', category: 'mobility', tags: ['caderas', 'warmup'] },

    // MOBILITY - TORSO
    { id: 'torso-rotations', title: 'Torso Rotations', description: 'Rotaciones de torso para movilidad espinal', category: 'mobility', tags: ['torso', 'warmup'] },
    { id: 't-spine-rotation', title: 'T-Spine Rotation', description: 'Rotación de columna torácica', category: 'mobility', tags: ['torso', 'stretch'] },

    // MOBILITY - SCAPULA
    { id: 'scapula-pushups', title: 'Scapula Push-ups', description: 'Push-ups escapulares para activación', category: 'mobility', tags: ['scapula', 'warmup'] },
    { id: 'scapula-slides', title: 'Wall Scapula Slides', description: 'Deslizamientos de escápula en pared', category: 'mobility', tags: ['scapula', 'warmup'] },

    // SOFT TISSUE
    { id: 'foam-roll-lats', title: 'Foam Roll Lats', description: 'Rodillo en dorsales', category: 'recovery', tags: ['soft-tissue', 'recovery'] },
    { id: 'lacrosse-ball-shoulder', title: 'Lacrosse Ball Shoulder', description: 'Trabajo con pelota en hombro', category: 'recovery', tags: ['soft-tissue', 'recovery'] },

    // ANTES DE TIRAR - HIGH INTENSITY
    { id: 'crossover-row', title: 'Crossover Row', description: 'Remo cruzado con banda - 3 series x 8-10 reps', category: 'warmup', tags: ['pre-throwing', 'high'] },
    { id: 'reverse-fly-pulldown', title: 'Reverse Fly Pulldown', description: 'Jalón con apertura inversa - 3 series x 8-10 reps', category: 'warmup', tags: ['pre-throwing', 'high'] },
    { id: 'crossover-90-90', title: 'Crossover 90/90', description: 'Ejercicio 90/90 con banda cruzada', category: 'warmup', tags: ['pre-throwing', 'medium'] },
    { id: 'crossover-scaption', title: 'Crossover Scaption', description: 'Scaption con banda cruzada', category: 'warmup', tags: ['pre-throwing', 'medium'] },
    { id: 'crossover-incline-push', title: 'Crossover Incline Push', description: 'Empuje inclinado con banda', category: 'warmup', tags: ['pre-throwing', 'low'] },
    { id: 'atyt', title: 'ATYT', description: 'Ejercicio ATYT para estabilidad de hombro - Set 1', category: 'warmup', tags: ['pre-throwing', 'shoulder'] },
    { id: 'wy-negative', title: 'WY Negative', description: 'WY con fase negativa - Set 2', category: 'warmup', tags: ['pre-throwing', 'shoulder'] },
    { id: 'crossover-archer', title: 'Crossover Archer', description: 'Arquero con banda cruzada', category: 'warmup', tags: ['pre-throwing', 'high'] },
    { id: 'bear-hug', title: 'Bear Hug', description: 'Abrazo de oso con banda', category: 'warmup', tags: ['pre-throwing', 'high'] },

    // MECHANICAL WORK
    { id: 'hinge-progression-1', title: 'Hinge Progression #1', description: 'Primera progresión del movimiento de bisagra para mecánica de lanzamiento', category: 'mechanics', tags: ['drill', 'hinge'] },
    { id: 'hinge-progression-2', title: 'Hinge Progression #2', description: 'Segunda progresión del movimiento de bisagra - más avanzado', category: 'mechanics', tags: ['drill', 'hinge'] },
    { id: 'athletic-day', title: 'Athletic Day', description: 'Día de trabajo atlético general', category: 'mechanics', tags: ['drill', 'athletic'] },

    // THROWING PROGRAM
    { id: 'throw-60ft-low', title: 'Throws @ 60ft (Low Intent)', description: '10 lanzamientos a 60 pies - RPE 3-4/10', category: 'throwing', tags: ['throwing', 'low-intent'] },
    { id: 'throw-75ft-low', title: 'Throws @ 75ft (Low Intent)', description: '10 lanzamientos a 75 pies - RPE 3-4/10', category: 'throwing', tags: ['throwing', 'low-intent'] },
    { id: 'throw-90ft-low', title: 'Throws @ 90ft (Low Intent)', description: '15 lanzamientos a 90 pies - RPE 3-4/10', category: 'throwing', tags: ['throwing', 'low-intent'] },
    { id: 'throw-60ft-mid', title: 'Throws @ 60ft (Mid Intent)', description: '10 lanzamientos a 60 pies - RPE 5-6/10', category: 'throwing', tags: ['throwing', 'mid-intent'] },
    { id: 'throw-75ft-mid', title: 'Throws @ 75ft (Mid Intent)', description: '10 lanzamientos a 75 pies - RPE 5-6/10', category: 'throwing', tags: ['throwing', 'mid-intent'] },
    { id: 'throw-90ft-mid', title: 'Throws @ 90ft (Mid Intent)', description: '10 lanzamientos a 90 pies - RPE 5-6/10', category: 'throwing', tags: ['throwing', 'mid-intent'] },
    { id: 'throw-120ft-mid', title: 'Throws @ 120ft (Mid Intent)', description: '5-10 lanzamientos a 120 pies - RPE 5-6/10', category: 'throwing', tags: ['throwing', 'mid-intent'] },
    { id: 'throw-150ft-high', title: 'Throws @ 150ft (High Intent)', description: '5 lanzamientos a 150 pies - RPE 8/10', category: 'throwing', tags: ['throwing', 'high-intent'] },
    { id: 'throw-180ft-high', title: 'Throws @ 180ft (High Intent)', description: '5 lanzamientos a 180 pies - RPE 8/10', category: 'throwing', tags: ['throwing', 'high-intent'] },
    { id: 'shuffle-throws', title: 'Shuffle Throws @ 60ft', description: '4 lanzamientos con shuffle a 60 pies', category: 'throwing', tags: ['throwing', 'variation'] },

    // THROWING VARIATIONS
    { id: 'toss-up', title: 'Toss Up', description: 'Lanzamiento hacia arriba para sentir el brazo', category: 'throwing', tags: ['variation'] },
    { id: 'gira-y-lanza', title: 'Gira y Lanza', description: 'Girar y lanzar para trabajar rotación', category: 'throwing', tags: ['variation'] },
    { id: 'normal-rodado', title: 'Normal Rodado', description: 'Lanzamiento rodado normal', category: 'throwing', tags: ['variation'] },
    { id: 'slow-roller', title: 'Slow Roller', description: 'Rodado lento para control', category: 'throwing', tags: ['variation'] },

    // POST-THROWING
    { id: 'iso-flexion-90-walk', title: 'Isometric Flexion @ 90 Walk', description: 'Caminata con flexión isométrica a 90 grados - 2 sets x 6 reps', category: 'recovery', tags: ['post-throwing', 'isometric'] },
    { id: 'iso-extension-90-walk', title: 'Isometric Extension @ 90 Walk', description: 'Caminata con extensión isométrica a 90 grados - 2 sets x 6 reps', category: 'recovery', tags: ['post-throwing', 'isometric'] },
    { id: 'plank-shoulder-tap', title: 'Plank Shoulder Tap', description: 'Plancha con toque de hombro - 1 set x 10 taps', category: 'recovery', tags: ['post-throwing', 'stability'] },
    { id: 'shoulder-ext-rot-iso', title: 'Shoulder External Rotation Isometric', description: 'Rotación externa de hombro isométrica @ 90 Walk - 2 sets x 6 reps', category: 'recovery', tags: ['post-throwing', 'isometric'] },
    { id: 'rack-walk-kb', title: 'Rack Walk KB', description: 'Caminata con kettlebell en rack - 3 sets x 30 feet', category: 'recovery', tags: ['post-throwing', 'carry'] },

    // AGILITY WORK
    { id: 'broad-jump', title: 'Broad Jump', description: 'Salto largo - parte del trabajo de agilidad', category: 'conditioning', tags: ['agility', 'explosive'] },
    { id: 'skaters', title: 'Skaters', description: 'Patinadores laterales - 3 sets x 3 reps', category: 'conditioning', tags: ['agility', 'lateral'] },
    { id: 'sprints-60-90', title: 'Sprints 60ft & 90ft', description: 'Sprints: 2-4 @ 60 pies, 2-4 @ 90 pies', category: 'conditioning', tags: ['agility', 'speed'] },

    // MEDICINE BALL WORK
    { id: 'mb-hip-hinge', title: 'Med Ball Hip Hinge', description: 'Bisagra de cadera con balón medicinal', category: 'conditioning', tags: ['med-ball', 'power'] },
    { id: 'mb-double-pump', title: 'Med Ball Double Pump', description: 'Doble bombeo con balón medicinal', category: 'conditioning', tags: ['med-ball', 'power'] },
    { id: 'mb-scoop-toss', title: 'Med Ball Scoop Toss', description: 'Lanzamiento de cuchara con balón medicinal - 3 series x 5 reps', category: 'conditioning', tags: ['med-ball', 'power'] },
  ];

  const createdDrills: Record<string, string> = {};

  for (const drill of drillsData) {
    const created = await prisma.drill.upsert({
      where: { id: drill.id },
      update: drill,
      create: drill,
    });
    createdDrills[drill.id] = created.id;
  }

  return createdDrills;
}

function getWeekDescription(weekNum: number): string {
  const descriptions: Record<number, string> = {
    1: 'Semana de introducción - Enfoque en movilidad básica y programa de tiro de baja intensidad. Hinge Progression #1.',
    2: 'Continuación del trabajo base - Mantener consistencia en movilidad y aumentar ligeramente distancias de tiro.',
    3: 'Semana de progresión - Introducción de Hinge Progression #2 y días de alta intensidad en tiro (hasta 180 pies).',
    4: 'Semana de consolidación - Mantener trabajo avanzado y preparar para siguiente fase de entrenamiento.',
  };
  return descriptions[weekNum] || '';
}

function getDayData(weekNum: number, dayNum: number, drills: Record<string, string>) {
  const dayNames = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  // Sunday is always rest day
  if (dayNum === 7) {
    return {
      title: 'Domingo - Día de Descanso',
      drillIds: [],
      notes: 'DIA LIBRE COMPLETO - DESCANSA Y TOMA AGUA. La recuperación es esencial para el progreso.',
      restDay: true,
    };
  }

  const isWeek3or4 = weekNum >= 3;

  // Define day structures
  const dayStructures: Record<number, any> = {
    // MONDAY - Low Intent Day
    1: {
      title: `${dayNames[dayNum]} - Low Intent`,
      drillIds: [
        drills['hip-circles'], drills['hip-flexor-stretch'], // Caderas: 2 exercises
        drills['torso-rotations'], drills['t-spine-rotation'], // Torso: 2 exercises
        drills['crossover-row'], drills['reverse-fly-pulldown'], // Pre-throwing HIGH
        drills['crossover-90-90'], drills['crossover-scaption'], drills['crossover-incline-push'],
        isWeek3or4 ? drills['hinge-progression-2'] : drills['hinge-progression-1'],
        drills['throw-60ft-low'], drills['throw-75ft-low'], drills['throw-90ft-low'],
        drills['toss-up'], drills['gira-y-lanza'], drills['normal-rodado'], drills['slow-roller'],
        drills['iso-flexion-90-walk'], drills['iso-extension-90-walk'],
        drills['broad-jump'], drills['skaters'], drills['sprints-60-90'],
      ].filter(Boolean),
      notes: `MOVILIDAD: Caderas (2 ejercicios) + Torso (2 ejercicios)
ANTES DE TIRAR: HIGH (3 series x 8-10 reps) - Super Set #1: Crossover Row, Reverse Fly Pulldown
MECHANICAL WORK: ${isWeek3or4 ? 'Hinge Progression #2' : 'Hinge Progression #1'}
PROGRAMA DE TIRO: Low Intent (RPE 3-4/10) - 10@60', 10@75', 15@90'
VARIACIONES: Toss Up, Gira y Lanza, Normal Rodado, Slow Roller
DESPUÉS DE LANZAR: Isometric Hold Flexion/Extension @ 90 Walk (2x6)
TRABAJO DE AGILIDAD: Broad Jump Skaters (3x3), Sprints 2@60' 2@90'`,
      restDay: false,
    },

    // TUESDAY - Mid Intent Day (or High Intensity in weeks 3-4)
    2: {
      title: `${dayNames[dayNum]} - ${isWeek3or4 ? 'Alta Intensidad' : 'Mid Intent'}`,
      drillIds: [
        drills['hip-circles'], drills['hip-flexor-stretch'], // Caderas solamente
        drills['atyt'], drills['wy-negative'], // Pre-throwing MEDIUM
        drills['crossover-archer'], drills['bear-hug'],
        isWeek3or4 ? drills['athletic-day'] : drills['hinge-progression-1'],
        ...(isWeek3or4 ? [
          drills['throw-60ft-low'], drills['throw-75ft-low'], drills['throw-90ft-mid'],
          drills['throw-120ft-mid'], drills['throw-150ft-high'], drills['throw-180ft-high'],
        ] : [
          drills['throw-60ft-mid'], drills['throw-75ft-mid'], drills['throw-90ft-mid'], drills['throw-120ft-mid'],
        ]),
        drills['shoulder-ext-rot-iso'], drills['rack-walk-kb'],
        drills['mb-hip-hinge'], drills['mb-double-pump'], drills['mb-scoop-toss'],
      ].filter(Boolean),
      notes: isWeek3or4
        ? `MOVILIDAD: Caderas solamente
ANTES DE TIRAR: MEDIUM (3 series x 8-10 reps) - Set #1 ATYT, Set #2 WY Negative, Super Set #1 Crossover Archer Bear Hug
MECHANICAL WORK: Athletic Day
PROGRAMA DE TIRO: ALTA INTENSIDAD (RPE 8/10) - Progresión hasta 180 pies
DESPUÉS DE LANZAR: Shoulder Ext Rot Isometric (2x6), Rack Walk KB (3x30')
BALONES MEDICINALES: Hip Hinge, Double Pump, Scoop Toss (3x5)`
        : `MOVILIDAD: Caderas solamente
ANTES DE TIRAR: MEDIUM (3 series x 8-10 reps) - Set #1 ATYT, Set #2 WY Negative
MECHANICAL WORK: Hinge Progression #1
PROGRAMA DE TIRO: Mid Intent (RPE 5-6/10) - 5@60', 10@60', 10@75', 10@90', 5@120'
VARIACIONES: Normal Rodado, Slow Roller
DESPUÉS DE LANZAR: Shoulder Ext Rot Isometric (2x6), Rack Walk KB (3x30')
BALONES MEDICINALES: Hip Hinge, Double Pump, Scoop Toss (3x5)`,
      restDay: false,
    },

    // WEDNESDAY - OFF Day (No throwing)
    3: {
      title: `${dayNames[dayNum]} - OFF Day`,
      drillIds: [
        drills['hip-circles'], drills['hip-flexor-stretch'], drills['90-90-stretch'], drills['hip-cars'],
        drills['scapula-pushups'], drills['scapula-slides'],
        drills['torso-rotations'], drills['t-spine-rotation'],
        drills['foam-roll-lats'], drills['lacrosse-ball-shoulder'],
        drills['crossover-90-90'], drills['crossover-scaption'], drills['crossover-incline-push'],
        drills['atyt'], drills['wy-negative'],
        isWeek3or4 ? drills['hinge-progression-2'] : drills['hinge-progression-1'],
      ].filter(Boolean),
      notes: `MOVILIDAD COMPLETA: Caderas, Scapula, Torso + Soft Tissue
ANTES DE TIRAR: LOW (3 series x 8-10 reps) - Crossover 90/90, Scaption, Incline Push, ATYT, WY Negative
MECHANICAL WORK: ${isWeek3or4 ? 'Hinge Progression #2' : 'Hinge Progression #1'}
PROGRAMA DE TIRO: OFF DAY - NO TIRAR
Enfócate en recuperación y trabajo de movilidad.`,
      restDay: false,
    },

    // THURSDAY - Low Intent Day
    4: {
      title: `${dayNames[dayNum]} - Low Intent`,
      drillIds: [
        drills['hip-circles'], drills['hip-flexor-stretch'],
        drills['torso-rotations'], drills['t-spine-rotation'],
        drills['crossover-row'], drills['reverse-fly-pulldown'],
        drills['crossover-90-90'], drills['crossover-scaption'], drills['crossover-incline-push'],
        isWeek3or4 ? drills['hinge-progression-2'] : drills['hinge-progression-1'],
        drills['throw-60ft-low'], drills['throw-75ft-low'], drills['throw-90ft-low'],
        drills['toss-up'], drills['gira-y-lanza'], drills['normal-rodado'], drills['slow-roller'],
        drills['iso-flexion-90-walk'], drills['iso-extension-90-walk'], drills['plank-shoulder-tap'],
        drills['mb-hip-hinge'], drills['mb-double-pump'], drills['mb-scoop-toss'],
      ].filter(Boolean),
      notes: `MOVILIDAD: Caderas (2 ejercicios) + Torso (2 ejercicios)
ANTES DE TIRAR: HIGH (3 series x 8-10 reps) - Super Set #1: Crossover Row, Reverse Fly Pulldown
MECHANICAL WORK: ${isWeek3or4 ? 'Hinge Progression #2' : 'Hinge Progression #1'}
PROGRAMA DE TIRO: Low Intent (RPE 3-4/10) - 10@60', 10@75', 15@90'
VARIACIONES: Toss Up, Gira y Lanza, Normal Rodado, Slow Roller
DESPUÉS DE LANZAR: Isometric Flexion/Extension (2x6), Plank Shoulder Tap (1x10)
BALONES MEDICINALES: Hip Hinge, Double Pump, Scoop Toss (3x5)`,
      restDay: false,
    },

    // FRIDAY - Mid Intent Day
    5: {
      title: `${dayNames[dayNum]} - Mid Intent`,
      drillIds: [
        drills['hip-circles'], drills['hip-flexor-stretch'],
        drills['torso-rotations'],
        drills['atyt'], drills['wy-negative'],
        isWeek3or4 ? drills['hinge-progression-1'] : drills['hinge-progression-1'],
        drills['throw-60ft-mid'], drills['throw-75ft-mid'], drills['throw-90ft-mid'],
        drills['throw-120ft-mid'],
        drills['normal-rodado'], drills['slow-roller'],
        drills['shoulder-ext-rot-iso'], drills['rack-walk-kb'],
        drills['broad-jump'], drills['skaters'], drills['sprints-60-90'],
      ].filter(Boolean),
      notes: `MOVILIDAD: Cadera + Torso
ANTES DE TIRAR: MEDIUM (3 series x 8-10 reps) - Set #1 ATYT, Set #2 WY Negative
MECHANICAL WORK: Hinge Progression #1
PROGRAMA DE TIRO: Mid Intent (RPE 5-6/10) - 10@60', 10@75', 10@90', 10-15@120'
VARIACIONES: Normal Rodado, Slow Roller
DESPUÉS DE LANZAR: Shoulder Ext Rot Isometric (2x6), Rack Walk KB (3x30')
TRABAJO DE AGILIDAD: Broad Jump Skaters (3x3), Sprints 2@60' 2@90'`,
      restDay: false,
    },

    // SATURDAY - Recovery/Mobility Focus
    6: {
      title: `${dayNames[dayNum]} - Movilidad Completa`,
      drillIds: [
        drills['hip-circles'], drills['hip-flexor-stretch'], drills['90-90-stretch'], drills['hip-cars'],
        drills['scapula-pushups'], drills['scapula-slides'],
        drills['torso-rotations'], drills['t-spine-rotation'],
        drills['foam-roll-lats'], drills['lacrosse-ball-shoulder'],
      ].filter(Boolean),
      notes: `MOVILIDAD COMPLETA: Caderas, Scapula, Torso + Soft Tissue
Día enfocado en recuperación activa y preparación para la próxima semana.
NO HAY PROGRAMA DE TIRO - Enfócate en calidad de movimiento.`,
      restDay: false,
    },
  };

  return dayStructures[dayNum] || {
    title: dayNames[dayNum],
    drillIds: [],
    notes: '',
    restDay: false,
  };
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
