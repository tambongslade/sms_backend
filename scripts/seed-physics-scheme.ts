/**
 * Seeds the Physics National Harmonised Progression (2025-2026) for
 * every Physics-teaching class into the current academic year.
 *
 * Source: 25-26_PHYSICS_NATIONAL_HARMONISED_PROGRESSION_DIGITALISATION
 *         _1st_and_2nd_cycles_Final 2025-2026.pdf
 *
 * Idempotent: deletes any existing SubjectScheme for (Physics, class, year)
 * before recreating (cascades to modules/chapters/lessons).
 *
 * Run:  npx ts-node scripts/seed-physics-scheme.ts
 */

import { PrismaClient, LessonEntryType } from '@prisma/client';

const prisma = new PrismaClient();

type Term = 1 | 2 | 3;

interface Lesson {
    term: Term;
    week: number;
    periods: number;
    entry?: LessonEntryType;      // default LESSON
    title: string;
    objectives?: string;
    handsOn?: string;
    digital?: boolean;            // "Available" = true, "Not yet" = false
}

interface Chapter {
    code?: string;
    title: string;
    lessons: Lesson[];
}

interface Module {
    code: string;
    title: string;
    chapters: Chapter[];
}

interface SchemeData {
    className: string;
    periodsPerWeek: number;
    annualTeachingHours: number;
    notes?: string;
    modules: Module[];
}

/* -------------------------------------------------------------------------- */
/* Reusable synthetic chapter for module-level assessment rows                */
/* -------------------------------------------------------------------------- */

const ASSESSMENT_TITLE = 'Integration, Evaluation & Remediation';

/* ============================== FORM 1 (2 p/wk, 50 h) ====================== */

const FORM_1: SchemeData = {
    className: 'FORM 1',
    periodsPerWeek: 2,
    annualTeachingHours: 50,
    modules: [
        {
            code: 'MODULE 1',
            title: 'THE WORLD OF SCIENCE',
            chapters: [
                {
                    title: 'Introduction to sciences + Scientific contributions and discoveries',
                    lessons: [
                        { term: 1, week: 1, periods: 1, digital: true, title: 'First contact with the learners, definition and branches of science.', handsOn: 'Show how straight stick/pencil/ruler will appear when placed inclined in water with one end air and other in water. Use of a triangular glass prism to produce a spectrum. Observe writings on a page through a convex lens. A balloon rubbed so that it sticks to a wall or ceiling when released. (NB: These activities are mainly for observation and curiosity of learners with no explanation at this level.)' },
                        { term: 1, week: 1, periods: 1, digital: true, title: 'Prominent scientists and discoveries and contributions to improvement in the lives of humans.' },
                    ],
                },
                {
                    title: 'Introduction to Physics',
                    lessons: [
                        { term: 1, week: 2, periods: 1, digital: true, title: 'Definition of physics and some of its branches.', objectives: 'What physicists do and how. Observing nature and seeking comprehension.' },
                    ],
                },
                {
                    title: 'Basic laboratory equipment',
                    lessons: [
                        { term: 1, week: 2, periods: 1, digital: true, title: 'Some basic equipment in the Physics laboratory.' },
                    ],
                },
                {
                    title: 'Safety laboratory rules',
                    lessons: [
                        { term: 1, week: 3, periods: 2, digital: true, title: 'Safety rules for working in the Physics laboratory.' },
                    ],
                },
                {
                    title: 'Introduction to measurement',
                    lessons: [
                        { term: 1, week: 4, periods: 1, digital: true, title: 'Job opportunities for science students.' },
                        { term: 1, week: 4, periods: 1, digital: true, title: 'Concepts of simple measurements using measuring instruments.' },
                    ],
                },
                {
                    title: 'Physical quantities',
                    lessons: [
                        { term: 1, week: 5, periods: 2, digital: true, title: 'Identifying physical and non-physical quantities.', objectives: 'Some Units of measurement and S.I units.' },
                    ],
                },
                {
                    title: ASSESSMENT_TITLE,
                    lessons: [
                        { term: 1, week: 6, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 1, week: 6, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 1, week: 7, periods: 1, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE II',
            title: 'MATTER: PROPERTIES AND TRANSFORMATION',
            chapters: [
                {
                    title: 'Matter',
                    lessons: [
                        { term: 1, week: 7, periods: 1, digital: true, title: 'States of matter and differences between them.', handsOn: 'Measurement of length, using a ruler/tape. Measurement of diameter of a spherical object by placing it between two parallel sided piece of wood. Measurement of mass.' },
                    ],
                },
                {
                    title: 'States of matter',
                    lessons: [
                        { term: 1, week: 8, periods: 2, digital: true, title: 'Interconversion processes.' },
                    ],
                },
                {
                    title: 'Measurement of length',
                    lessons: [
                        { term: 1, week: 9, periods: 2, digital: true, title: 'Define length & state its S.I and sub units.', objectives: 'Measurement of length.' },
                    ],
                },
                {
                    title: 'Measurement of mass',
                    lessons: [
                        { term: 1, week: 10, periods: 2, digital: true, title: 'Define mass and state its SI and sub units.', objectives: 'Measurement of the mass of a body.' },
                    ],
                },
                {
                    title: 'Measurement of weight',
                    lessons: [
                        { term: 1, week: 11, periods: 2, digital: true, title: 'Define weight and state its units.', objectives: 'Differentiate between mass & weight. Measurement of weight.' },
                    ],
                },
                {
                    title: ASSESSMENT_TITLE + ' (part 1)',
                    lessons: [
                        { term: 1, week: 12, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 1, week: 12, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 2, week: 13, periods: 1, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                    ],
                },
                {
                    title: 'Measurement of volume',
                    lessons: [
                        { term: 2, week: 13, periods: 1, digital: true, title: 'Define volume & state its units.', objectives: 'Measurement of volumes of liquids, regular & irregular solids.', handsOn: 'Measurement of volume of liquid and solids (regular and irregular shaped). Measurement of temperature. Application of measurement to determine density of water, piece of stone, piece of cubic or rectangular piece.' },
                    ],
                },
                {
                    title: 'Measurement of Density',
                    lessons: [
                        { term: 2, week: 14, periods: 1, digital: true, title: 'Define density as the mass per unit volume and state its units.' },
                    ],
                },
                {
                    title: 'Measurement of Temperature',
                    lessons: [
                        { term: 2, week: 14, periods: 1, digital: true, title: 'Define temperature and state its S.I and sub units/conversion.' },
                    ],
                },
                {
                    title: 'Using information on products',
                    lessons: [
                        { term: 2, week: 15, periods: 1, digital: true, title: 'Safety rules on products/materials.', objectives: 'Using information.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE III',
            title: 'ENERGY: APPLICATIONS AND USES',
            chapters: [
                {
                    title: 'Forms of energy',
                    lessons: [
                        { term: 2, week: 15, periods: 1, digital: true, title: 'Definition, forms, sources of energy.', handsOn: 'Use of candle wax marks placed on metal and non-metal and the other end held close to a candle flame to demonstrate good and bad conductors. Convection: Water is heated in a beaker, plastic transparent cup or polythene bag.' },
                    ],
                },
                {
                    title: 'Energy needs',
                    lessons: [
                        { term: 2, week: 16, periods: 2, digital: true, title: 'Daily applications of energy.', objectives: 'Common devices that use different forms of energy and principle of energy conservation.' },
                    ],
                },
                {
                    title: 'Solar energy',
                    lessons: [
                        { term: 2, week: 17, periods: 1, digital: true, title: 'Components and uses of solar energy.' },
                    ],
                },
                {
                    title: 'Chemical energy',
                    lessons: [
                        { term: 2, week: 17, periods: 1, digital: true, title: 'Sources and uses of chemical energy.' },
                    ],
                },
                {
                    title: ASSESSMENT_TITLE,
                    lessons: [
                        { term: 2, week: 18, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 2, week: 18, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 2, week: 19, periods: 1, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                    ],
                },
                {
                    title: 'Electrical energy',
                    lessons: [
                        { term: 2, week: 19, periods: 1, digital: false, title: 'Sources and uses of electrical energy.' },
                    ],
                },
                {
                    title: 'Thermal energy',
                    lessons: [
                        { term: 2, week: 20, periods: 1, digital: false, title: 'Sources and uses of heat.' },
                        { term: 2, week: 20, periods: 1, digital: false, title: 'Heat transfer.', objectives: 'Heat transfer by conduction (conductors / insulators). Heat transfer by convection / application (ventilation). Heat transfer by radiation (good and bad absorbers/emitters).', handsOn: 'Radiation: Candle wax on a metal is held at different distances from a burning candle flame. Soaking a piece of paper and holding it close to a burning candle. Light a bulb using a cell or battery.' },
                    ],
                },
                {
                    title: 'Forces and motion',
                    lessons: [
                        { term: 2, week: 21, periods: 1, digital: false, title: 'Definition and effects of forces.' },
                        { term: 2, week: 21, periods: 1, digital: false, title: 'Definition/types of motion (straight line, circular and to and fro).' },
                        { term: 2, week: 22, periods: 2, digital: false, title: 'Safety rules: uses of seat belts, low speed/road signs.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE IV',
            title: 'HEALTH EDUCATION',
            chapters: [
                {
                    title: 'Sound',
                    lessons: [
                        { term: 2, week: 23, periods: 1, digital: false, title: 'Definition and production.', handsOn: 'Measurement of body temperature using a clinical thermometer. Making of any local instrument (eg tomato tins plus metal wires) to produce sound such that loudness can be varied.' },
                        { term: 2, week: 23, periods: 1, digital: false, title: 'The ear and sound perception.' },
                    ],
                },
                {
                    title: ASSESSMENT_TITLE + ' (part 1)',
                    lessons: [
                        { term: 2, week: 24, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 2, week: 24, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 3, week: 25, periods: 1, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                    ],
                },
                {
                    title: 'Detection of sound',
                    lessons: [
                        { term: 3, week: 25, periods: 1, digital: false, title: 'Effects of loud sound and prevention.' },
                    ],
                },
                {
                    title: 'Temperature',
                    lessons: [
                        { term: 3, week: 26, periods: 1, digital: false, title: 'Measurement of temperature of the human body (clinical thermometer).', objectives: 'Normal and abnormal body temperatures.' },
                    ],
                },
                {
                    title: 'Sports and physics',
                    lessons: [
                        { term: 3, week: 26, periods: 1, digital: false, title: 'Body posture: importance of good posture to the body.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE V',
            title: 'ENVIRONMENTAL EDUCATION AND SUSTAINABLE DEVELOPMENT',
            chapters: [
                {
                    title: 'RADIATIONS',
                    lessons: [
                        { term: 3, week: 27, periods: 2, digital: false, title: 'Harmful waste & background radiation.', objectives: 'Handling radioactive substances.', handsOn: 'Two boxes are designed from glass or transparent plastics with one completely sealed leaving a possibility to insert a thermometer while the other has an opening. The two boxes are exposed to the sun for about 30 minutes, the readings of the thermometers can be used to explain the greenhouse effect.' },
                    ],
                },
                {
                    title: 'Global warming and climate change',
                    lessons: [
                        { term: 3, week: 28, periods: 2, digital: false, title: 'Greenhouse effect (concept/causes).', objectives: 'Climate change. Environmental sustainability.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE VI',
            title: 'TECHNOLOGY',
            chapters: [
                {
                    title: 'Common tools',
                    lessons: [
                        { term: 3, week: 29, periods: 1, digital: false, title: 'Machines (identification and uses).', handsOn: 'Drawing the 6 faces of an object such as a digital multimeter separately.' },
                    ],
                },
                {
                    title: 'Maintenance',
                    lessons: [
                        { term: 3, week: 29, periods: 1, digital: false, title: 'Lubrication, cleaning and repairs using the tools.' },
                    ],
                },
                {
                    title: ASSESSMENT_TITLE,
                    lessons: [
                        { term: 3, week: 30, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 3, week: 30, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 3, week: 31, periods: 1, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                    ],
                },
                {
                    title: 'Technical drawing',
                    lessons: [
                        { term: 3, week: 31, periods: 1, digital: false, title: 'Instruments used / sample drawing.' },
                    ],
                },
                {
                    title: 'End of Year',
                    lessons: [
                        { term: 3, week: 32, periods: 10, entry: 'REVISION', title: 'General Revision / End of Year Examination (weeks 32-36).' },
                    ],
                },
            ],
        },
    ],
};

/* ============================== FORM 2 (2 p/wk, 50 h) ====================== */

const FORM_2: SchemeData = {
    className: 'FORM 2',
    periodsPerWeek: 2,
    annualTeachingHours: 50,
    modules: [
        {
            code: 'Module 1',
            title: 'The world of science',
            chapters: [
                {
                    title: 'Introduction',
                    lessons: [
                        { term: 1, week: 1, periods: 2, title: 'First contact with students and presentation of scheme of work.' },
                    ],
                },
                {
                    code: '1',
                    title: 'Scientific method part 2',
                    lessons: [
                        { term: 1, week: 1, periods: 1, digital: true, title: '1.0 Collecting data - importance of data.', handsOn: 'Loading a helical spring to obtain a table of mass and corresponding extension and calculate the mass per unit length. Provide rectangular wooden blocks of same material, for learners to measure length, breadth, height and mass and use to calculate density.' },
                        { term: 1, week: 2, periods: 1, digital: true, title: '1.2 Interpreting data and concluding.' },
                        { term: 1, week: 2, periods: 1, digital: true, title: '1.3 Predicting and evaluating.' },
                    ],
                },
                {
                    code: '2',
                    title: 'Simple application of measurements',
                    lessons: [
                        { term: 1, week: 3, periods: 2, digital: true, title: '1.4 Planning (recall basic quantities units and instruments).', objectives: '1.5 Measurements of speed and units.' },
                        { term: 1, week: 4, periods: 2, digital: true, title: '1.6 Measurement of density and Units.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 2',
            title: 'Matter, Properties and transformation',
            chapters: [
                {
                    code: '3',
                    title: 'Change of state',
                    lessons: [
                        { term: 1, week: 5, periods: 2, digital: true, title: '2.1 Physical states of matter.', objectives: '2.2 Characteristics of matter in the different states.', handsOn: 'Measuring the temperature of a room, water and human body. Allowing ice to melt while in contact with another object whose temperature we can measure. Allowing spirit to evaporate while in contact with a body whose temperature we can measure.' },
                    ],
                },
                {
                    title: ASSESSMENT_TITLE + ' (part 1)',
                    lessons: [
                        { term: 1, week: 6, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 1, week: 6, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 1, week: 7, periods: 1, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                    ],
                },
                {
                    code: '4',
                    title: 'Temperature',
                    lessons: [
                        { term: 1, week: 7, periods: 1, digital: true, title: '2.3 Temperature - measurement and units and effects on matter.' },
                    ],
                },
                {
                    code: '5',
                    title: 'Thermal and electrical insulation',
                    lessons: [
                        { term: 1, week: 8, periods: 2, digital: true, title: '2.4 Thermal and electrical insulation.' },
                    ],
                },
                {
                    code: '6',
                    title: 'Action of heat and electrical energy',
                    lessons: [
                        { term: 1, week: 9, periods: 2, digital: true, title: '2.5 Action of heat on materials.', objectives: '2.6 Action of electrical energy on materials.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 3',
            title: 'Energy, value and uses',
            chapters: [
                {
                    code: '9',
                    title: 'Energy needs of human beings',
                    lessons: [
                        { term: 1, week: 10, periods: 2, digital: false, title: 'Sources and uses of energy. Transmission of energy.', handsOn: 'Light a candle so that it burns and we can show that it gives out heat which can be used for heating, drying, cooking as light for seeing.' },
                    ],
                },
                {
                    code: '10',
                    title: 'Renewable energy',
                    lessons: [
                        { term: 1, week: 11, periods: 2, digital: false, title: 'Solar panel for heating. Other sources.' },
                    ],
                },
                {
                    title: ASSESSMENT_TITLE + ' (part 1)',
                    lessons: [
                        { term: 1, week: 12, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 1, week: 12, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 2, week: 13, periods: 1, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                    ],
                },
                {
                    code: '11',
                    title: 'Electricity',
                    lessons: [
                        { term: 2, week: 13, periods: 1, digital: false, title: 'Electricity for the home and the simple electric circuit.', handsOn: 'Use a photovoltaic plate to light a small bulb to identify forms of energy. Power a small radio with batteries for it to emit sound.' },
                    ],
                },
                {
                    code: '12',
                    title: 'Light',
                    lessons: [
                        { term: 2, week: 14, periods: 1, digital: false, title: 'Sources of Light.' },
                        { term: 2, week: 14, periods: 1, digital: false, title: 'Types of light receivers.' },
                        { term: 2, week: 14, periods: 1, digital: false, title: 'Beams and shadows.' },
                    ],
                },
                {
                    code: '13',
                    title: 'Energy exchange',
                    lessons: [
                        { term: 2, week: 15, periods: 2, digital: false, title: 'Linking one form of energy to other forms.' },
                    ],
                },
                {
                    code: '14',
                    title: 'Motion',
                    lessons: [
                        { term: 2, week: 16, periods: 2, digital: false, title: 'Distance, time and speed.' },
                    ],
                },
                {
                    code: '15',
                    title: 'Distribution of pressure in a liquid',
                    lessons: [
                        { term: 2, week: 17, periods: 2, digital: false, title: '4. Average blood pressure.', handsOn: 'Use a syringe and plastic bottles with small holes to demonstrate liquid pressure when pushed using a piston or driven by a height difference.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 4',
            title: 'Health education',
            chapters: [
                {
                    title: ASSESSMENT_TITLE,
                    lessons: [
                        { term: 2, week: 18, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 2, week: 18, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 2, week: 19, periods: 1, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                    ],
                },
                {
                    code: '16',
                    title: 'Muscle stress',
                    lessons: [
                        { term: 2, week: 19, periods: 1, digital: false, title: 'Sports and physical education.' },
                    ],
                },
                {
                    code: '17',
                    title: 'Types of lenses and their uses',
                    lessons: [
                        { term: 2, week: 20, periods: 2, digital: false, title: 'The eye as an imaging device and use of lenses to aid eyes with vision defects.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 5',
            title: 'Environmental Protection and sustainable development',
            chapters: [
                {
                    code: '18',
                    title: 'Radiation',
                    lessons: [
                        { term: 2, week: 21, periods: 2, digital: false, title: '5.0 Introduction.', objectives: '5.1 Radiation emitted into the atmosphere. Cosmic waves from the sun.', handsOn: 'Using transparent glass or plastic to design a box in which there is a possibility to insert a thermometer and measure temperature with time after exposing to solar radiation.' },
                    ],
                },
                {
                    code: '19',
                    title: 'Weather and communication',
                    lessons: [
                        { term: 2, week: 22, periods: 2, digital: false, title: '5.1 The Greenhouse Effect.' },
                        { term: 2, week: 23, periods: 2, digital: false, title: '5.3 Global warming.' },
                    ],
                },
                {
                    title: ASSESSMENT_TITLE + ' (part 1)',
                    lessons: [
                        { term: 2, week: 24, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 2, week: 24, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 3, week: 25, periods: 1, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                        { term: 3, week: 25, periods: 2, digital: false, title: '5.4 Climate change.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 6',
            title: 'Technology',
            chapters: [
                {
                    code: '22',
                    title: 'Introduction to technology',
                    lessons: [
                        { term: 3, week: 26, periods: 2, digital: false, title: '6.0 Introduction to technology. Review of form one.', handsOn: 'Use a screw driver to drive a screw. Use a tester to identify a live terminal of a source. Draw a 3-D diagram of a multimeter.' },
                    ],
                },
                {
                    code: '23',
                    title: 'Project',
                    lessons: [
                        { term: 3, week: 27, periods: 2, digital: false, title: '6.1 Fabrication of common instruments.' },
                    ],
                },
                {
                    code: '24',
                    title: 'Care and maintenance',
                    lessons: [
                        { term: 3, week: 28, periods: 2, digital: false, title: '6.2 Care and maintenance.', objectives: 'Principle of functionality of some common appliances.' },
                    ],
                },
                {
                    code: '25',
                    title: 'Technical drawing',
                    lessons: [
                        { term: 3, week: 29, periods: 2, digital: false, title: '6.3 Technical drawing.' },
                    ],
                },
                {
                    title: 'End of Year',
                    lessons: [
                        { term: 3, week: 30, periods: 14, entry: 'REVISION', title: 'General Revision / End of Year Examination (weeks 30-36).' },
                    ],
                },
            ],
        },
    ],
};

/* ============================== FORM 3 (2 p/wk, 50 h) ====================== */

const FORM_3: SchemeData = {
    className: 'FORM 3',
    periodsPerWeek: 2,
    annualTeachingHours: 50,
    modules: [
        {
            code: 'MODULE 1',
            title: 'INTRODUCTION TO MECHANICS',
            chapters: [
                {
                    title: 'Introduction',
                    lessons: [
                        { term: 1, week: 1, periods: 0, title: 'First contact with the students.' },
                    ],
                },
                {
                    code: '1',
                    title: 'Physical quantities',
                    lessons: [
                        { term: 1, week: 1, periods: 2, digital: true, title: 'Definitions, examples and units of physical quantities.', objectives: 'Scalar physical quantities and vector quantities.', handsOn: 'Measure the length, width, and height of a box using a metre rule and use these measurements to determine its volume. Measure the diameter of a spherical object by placing it between two parallel sided piece of wood and use the measurement to determine its volume.' },
                        { term: 1, week: 1, periods: 2, digital: true, title: 'Prefixes and use of standard form.', objectives: 'Name some basic equipment used in the study of force: newton meter, balance, springs, masses etc.' },
                        { term: 1, week: 2, periods: 2, digital: true, title: 'Safety rules for working with different equipment.', objectives: 'Comparison between mass and weight.' },
                        { term: 1, week: 2, periods: 2, digital: true, title: 'Measurement of mass / Conversions between different units of mass.' },
                        { term: 1, week: 3, periods: 2, digital: true, title: 'Measurement of volume, temperature and time.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE II',
            title: 'MATTER: PROPERTIES AND TRANSFORMATION',
            chapters: [
                {
                    code: '2',
                    title: 'Density',
                    lessons: [
                        { term: 1, week: 4, periods: 2, digital: true, title: 'Definition / calculation / unit of density.', handsOn: 'Measure the density of a liquid, regular and irregular solids use the values obtained to determine whether the liquid or solid will float on water. Use a collapsing can to demonstrate atmospheric pressure. Use a syringe and plastic bottles with small holes to demonstrate the characteristics of pressure in liquids.' },
                        { term: 1, week: 4, periods: 2, digital: true, title: 'Describe and carry out experiments to measure the density of regular & irregular objects.' },
                        { term: 1, week: 4, periods: 2, digital: true, title: 'Applications of the density of a material in engineering works.' },
                    ],
                },
                {
                    code: '3',
                    title: 'Pressure',
                    lessons: [
                        { term: 1, week: 5, periods: 2, digital: true, title: 'Definition / calculation / unit of pressure.', objectives: 'Factors that affect pressure in solids. Application of pressure in solids.' },
                        { term: 1, week: 6, periods: 1, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 1, week: 6, periods: 1, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 1, week: 7, periods: 0, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                        { term: 1, week: 7, periods: 2, digital: true, title: 'Pressure in liquids.', objectives: 'Calculation / Factors affecting of pressure in liquids. Characteristics of pressure in liquids.' },
                        { term: 1, week: 8, periods: 2, digital: true, title: 'Applications; Hydraulic machines.', objectives: 'Atmospheric pressure and weather. Demonstration / Measurement / Application of atmospheric pressure. Pressure and health (Effects of high/low pressure).', handsOn: 'Load a helical spring and a rubber band separately with standard masses to obtain tables of mass and corresponding extension to: Demonstrate Hooke’s law. Distinguish between materials that obey Hooke’s law and those that do not.' },
                        { term: 1, week: 8, periods: 2, digital: true, title: 'Effects of pressure on boiling point.', objectives: 'Application of high pressure.' },
                    ],
                },
                {
                    code: '4',
                    title: "Elasticity and Hooke's law",
                    lessons: [
                        { term: 1, week: 9, periods: 2, digital: true, title: 'Definition of elasticity. Elastic and non-elastic materials. Hooke’s Law and elastic limit.' },
                        { term: 1, week: 9, periods: 2, digital: true, title: 'Sketch F - e graphs within the elastic limit.', objectives: 'Experimental demonstration of Hooke’s law. Describe situations in which Hooke’s law applies.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE III',
            title: 'ENERGY: APPLICATIONS AND USES',
            chapters: [
                {
                    code: '5',
                    title: 'Forms of energy',
                    lessons: [
                        { term: 1, week: 10, periods: 2, digital: true, title: 'Definition / Forms of energy.', handsOn: 'Use a photovoltaic plate to light a small bulb to identify forms of energy. Light a candle so that it burns and a small radio powered with batteries to demonstrate conversion of energy. Use a burning candle and a small bulb powered by a photovoltaic plate to distinguish between renewable and non-renewable energy sources. Use a spring or a rubber band to project a small object to demonstrate conversion of potential energy to kinetic energy.' },
                    ],
                },
                {
                    code: '6',
                    title: 'Sources of energy',
                    lessons: [
                        { term: 1, week: 10, periods: 2, digital: true, title: 'Sources of energy.', objectives: 'Renewable and non-renewable energy sources.' },
                    ],
                },
                {
                    code: '7',
                    title: 'Energy Transformations',
                    lessons: [
                        { term: 1, week: 10, periods: 2, digital: true, title: 'The law of conservation of energy / application.', objectives: 'Transducers and energy flow diagrams.' },
                        { term: 1, week: 11, periods: 2, digital: true, title: 'Energy transformations.', objectives: 'Calculations of potential (gravitational and elastic) and kinetic energies.' },
                    ],
                },
                {
                    code: '8',
                    title: 'Work',
                    lessons: [
                        { term: 1, week: 11, periods: 2, digital: true, title: 'Definition / Calculation of work involving force and displacement (in the same direction only).', objectives: 'Examples of situations where work is done.' },
                        { term: 1, week: 12, periods: 2, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 1, week: 12, periods: 0, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 1, week: 13, periods: 2, entry: 'REMEDIATION', title: 'Correction and Remediation', handsOn: 'Mount systems of one, two, three, four or five pulleys and use to lift loads.' },
                    ],
                },
                {
                    code: '9',
                    title: 'Power',
                    lessons: [
                        { term: 1, week: 13, periods: 2, digital: true, title: 'Definition / calculation of power.', objectives: 'Power ratings of some devices e.g. electric iron, light bulbs, electric motors etc.' },
                        { term: 1, week: 13, periods: 2, digital: true, title: 'Definition / advantages of a machine.' },
                    ],
                },
                {
                    code: '10',
                    title: 'Simple Machines',
                    lessons: [
                        { term: 2, week: 14, periods: 2, digital: true, title: 'MA / VR / Efficiency. Relationship between the three.', objectives: 'Simple machines (Lever, inclined plane and pulley, hydraulic machines) / Experiments and calculations.', handsOn: 'Use a simple torch and slits to produce rays and beams. Use a simple torch, slit(s) and mirrors to demonstrate reflection of light. Show how straight stick/pencil/ruler will appear when placed inclined in water with one end air and other in water. Use a simple torch, slit and glass block to demonstrate refraction of light, critical angle and total internal reflection. Use a burning candle and a convex lens to demonstrate images formed by converging lenses. Use a prism to demonstrate dispersion of white light.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE IV (Optics)',
            title: 'OPTICS',
            chapters: [
                {
                    code: '10',
                    title: 'Reflection of light',
                    lessons: [
                        { term: 2, week: 15, periods: 2, digital: false, title: 'Description / Propagation of light.', objectives: 'Rays and types of beams. Luminous and non-luminous sources of light. Transparent, translucent and Opaque objects. Shadows and applications.' },
                        { term: 2, week: 15, periods: 0, digital: false, title: 'Definition / laws of reflection of light.', objectives: 'Experiment to show that i = r.' },
                        { term: 2, week: 15, periods: 0, entry: 'BREAK', title: 'CHRISTMAS BREAK' },
                        { term: 2, week: 16, periods: 2, digital: false, title: 'Image formation by plane mirrors.', objectives: 'Characteristics of images formed by plane mirrors. Uses / Simple calculations on plane mirrors. Curved mirrors (Types and applications).' },
                    ],
                },
                {
                    code: '11',
                    title: 'Refraction of light',
                    lessons: [
                        { term: 2, week: 16, periods: 0, digital: false, title: 'Identification of refraction phenomena in everyday life / Definition of refraction.' },
                        { term: 2, week: 17, periods: 2, digital: false, title: 'Laws of refraction.', objectives: 'Refractive index and speed of light. Experiment to determine refractive index of a glass block.' },
                        { term: 2, week: 17, periods: 0, digital: false, title: 'Effects of refraction of light in everyday life.', objectives: 'Real/apparent depth and refractive index.' },
                        { term: 2, week: 18, periods: 2, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 2, week: 18, periods: 0, entry: 'EVALUATION', title: 'Evaluation' },
                        { term: 2, week: 19, periods: 0, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                        { term: 2, week: 19, periods: 2, digital: false, title: 'Total internal reflection (TIR).', objectives: 'Conditions / Daily occurrence / Definition of total internal reflection. Ray diagram to show TIR.' },
                    ],
                },
                {
                    code: '12',
                    title: 'LENSES',
                    lessons: [
                        { term: 2, week: 19, periods: 0, digital: false, title: 'Use of TIR / Solve problems using sin c = 1/n.' },
                        { term: 2, week: 20, periods: 2, digital: false, title: 'Lens action / Types of lenses / Definition of terms.' },
                        { term: 2, week: 21, periods: 2, digital: false, title: 'Ray diagrams to illustrate the meaning of principal foci, for converging & diverging lenses.', objectives: 'Measurement of focal length of a converging lens.' },
                        { term: 2, week: 22, periods: 2, digital: false, title: 'Image formation by converging/diverging lenses.', objectives: 'The lens formula and magnification, m = v/u.' },
                    ],
                },
                {
                    code: '13',
                    title: 'Dispersion of light',
                    lessons: [
                        { term: 2, week: 23, periods: 2, digital: false, title: 'Definition / Demonstration of dispersion.' },
                        { term: 2, week: 23, periods: 0, digital: false, title: 'Formation of a pure spectrum from white light.', objectives: 'Natural occurrence of the dispersion.' },
                        { term: 2, week: 24, periods: 2, entry: 'INTEGRATION', title: 'Activity of Integration' },
                        { term: 2, week: 24, periods: 0, entry: 'EVALUATION', title: 'Evaluation' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE IV',
            title: 'Projects and Elementary Engineering',
            chapters: [
                {
                    code: '14',
                    title: 'Understanding how to go about a Project',
                    lessons: [
                        { term: 3, week: 25, periods: 2, entry: 'REMEDIATION', title: 'Correction and Remediation' },
                        { term: 3, week: 25, periods: 0, digital: false, title: 'Technical drawing: General notions involved.', objectives: '2-dimensional diagrams/orthogonal representation.', handsOn: 'Draw a two-dimensional diagram of a wall of the classroom containing the door and windows.' },
                        { term: 3, week: 26, periods: 2, digital: false, title: 'Technical Project Types / Elements involved.', objectives: 'Definition / Steps involved in planning a project.' },
                        { term: 3, week: 26, periods: 2, digital: false, title: 'Study the advantages offered by the project; Feasibility Studies.', objectives: 'Theoretical knowledge of a simple technical object. Different energy components when using the instrument.' },
                        { term: 3, week: 27, periods: 2, digital: false, title: 'Technical diagram / studies.', objectives: 'Identification of the movement of certain parts with respect to others (guide, reducing friction).' },
                    ],
                },
                {
                    code: '15',
                    title: 'Investigating Forces',
                    lessons: [
                        { term: 3, week: 28, periods: 2, digital: false, title: 'Definition of new words. Realisation of a project.', objectives: 'Understand the uses of measuring instruments and their limitations. Understand why and how things move. Understand the relationship between mass and volume through measurements.' },
                        { term: 3, week: 28, periods: 0, entry: 'BREAK', title: 'EASTER BREAK' },
                        { term: 3, week: 29, periods: 2, digital: false, title: 'Observing colours of light on a CD or DVD and suggesting reasons for their appearance.' },
                        { term: 3, week: 29, periods: 0, digital: false, title: 'Observe a pen or pencil in a glass of water and explain why there is an image seen with the object.' },
                        { term: 3, week: 30, periods: 2, digital: false, title: 'Use the image to estimate the refractive index of water.' },
                    ],
                },
                {
                    title: 'End of Year',
                    lessons: [
                        { term: 3, week: 31, periods: 10, entry: 'REVISION', title: 'General Revision / End of Year Examination (weeks 31-35).' },
                    ],
                },
            ],
        },
    ],
};

/* ============================== FORM 4 (3 p/wk, 63 h) ====================== */

const FORM_4: SchemeData = {
    className: 'FORM 4',
    periodsPerWeek: 3,
    annualTeachingHours: 63,
    modules: [
        {
            code: 'MODULE 1',
            title: 'ENERGY: APPLICATION AND USES',
            chapters: [
                {
                    title: 'Introduction',
                    lessons: [
                        { term: 1, week: 1, periods: 0, title: 'First contact with students and presentation of scheme of work.' },
                    ],
                },
                {
                    title: 'Heat',
                    lessons: [
                        { term: 1, week: 1, periods: 3, digital: true, title: '1.1 Concept of heat and temperature.', objectives: '1.2 Measurement of temperature.', handsOn: 'Use a thermometer to measure temperature. Determine the specific heat capacity of water using an electric heater. Use of candle wax marks placed on metal and non-metal and the other end held close to a candle flame to demonstrate good and bad conductors. Heat water in a beaker, plastic transparent cup or polythene bag to demonstrate convection. Candle wax on a metal or a soaked piece of paper is held at a distances from a burning candle flame to demonstrate radiation.' },
                    ],
                },
                {
                    title: 'Thermometry',
                    lessons: [
                        { term: 1, week: 2, periods: 3, digital: true, title: '1.3 Thermometry. 1.4 Liquid-in-glass thermometer.', objectives: '1.5 Calibration of temperature scales using fixed points.' },
                        { term: 1, week: 3, periods: 3, digital: true, title: '1.6 Clinical and normal laboratory thermometers.' },
                    ],
                },
                {
                    title: 'Calorimetry',
                    lessons: [
                        { term: 1, week: 3, periods: 3, digital: true, title: '1.1 Calorimetry. 1.2 Heat capacity and specific heat capacity, c.', objectives: '1.3 Measurement of specific heat capacity, c for solids and liquids, Calculation involving Q = mcΔθ.' },
                    ],
                },
                {
                    title: 'Latent Heat',
                    lessons: [
                        { term: 1, week: 4, periods: 3, digital: true, title: '1.4 Latent Heat and specific Latent heat.', objectives: '1.5 Cooling effect.' },
                    ],
                },
                {
                    title: 'Heat transfer',
                    lessons: [
                        { term: 1, week: 4, periods: 3, digital: true, title: '1.6 Heat Transfer. Conduction, Convection and Radiation.' },
                    ],
                },
                {
                    title: 'Expansion',
                    lessons: [
                        { term: 1, week: 5, periods: 3, digital: true, title: '1.7 Thermal Expansion.', objectives: 'The bimetallic strip and its principles. Radiant energy converters.' },
                        { term: 1, week: 6, periods: 3, entry: 'INTEGRATION', title: 'Activity of Integration / Evaluation / Correction and Remediation.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE 2',
            title: 'WAVES',
            chapters: [
                {
                    title: 'Properties of Waves',
                    lessons: [
                        { term: 1, week: 7, periods: 3, digital: true, title: '2.1 Definition and classification of waves.', objectives: '2.2 Properties of waves: Reflection, Refraction, Diffraction and Interference. 2.3 Calculations using the equation v=fλ.', handsOn: 'Use a slinky coil to produce transverse and longitudinal waves. Use a ripple tank or water in a basin to produce water waves and demonstrate properties of water waves.' },
                    ],
                },
                {
                    title: 'Stationary Waves',
                    lessons: [
                        { term: 1, week: 8, periods: 3, digital: false, title: '2.4 Stationary waves.', objectives: '2.5 Harmonics and Overtones. 2.6 Relationship between inter-node distance and wavelength.' },
                    ],
                },
                {
                    title: 'Sound Waves',
                    lessons: [
                        { term: 1, week: 9, periods: 3, digital: false, title: '2.7 Production and transmission of sound.', objectives: '2.8 Characteristics of sound (Amplitude, frequency, and pitch, quality and overtones. Frequency limit of audibility).' },
                        { term: 1, week: 10, periods: 3, digital: false, title: '2.9 Measurement of the speed of sound (echo method and gun firing method). Application of echo in sea bed.', objectives: '2.10 Calculation of speed of sound in air.' },
                    ],
                },
                {
                    title: 'Vibration in strings',
                    lessons: [
                        { term: 1, week: 11, periods: 3, digital: false, title: '2.11 Vibrating strings.', objectives: 'Relationship between frequency and length, frequency and mass per unit length, frequency and tension.' },
                        { term: 1, week: 12, periods: 3, entry: 'INTEGRATION', title: 'Activity of Integration / Evaluation / Correction and Remediation.' },
                    ],
                },
                {
                    title: 'Forced vibration and Resonance',
                    lessons: [
                        { term: 2, week: 13, periods: 3, digital: false, title: 'Forced vibration on a string and in a tube.', objectives: 'Define and explain resonance. State importance and applications of resonance including measurement of speed of sound.' },
                    ],
                },
                {
                    title: 'EM Spectrum',
                    lessons: [
                        { term: 2, week: 14, periods: 3, digital: false, title: 'EM Spectrum.', objectives: 'Relative positions of radiation on EM spectrum, in terms of wavelength and frequency. Methods of production and detection. Properties and uses. Health hazards caused by EM waves.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE 3',
            title: 'ELECTRICAL ENERGY',
            chapters: [
                {
                    title: 'Electrostatics',
                    lessons: [
                        { term: 2, week: 15, periods: 3, digital: false, title: '3.1 Charges and their origins.', objectives: '3.2 Types of charges and the Basic law of electrostatics. 3.3 Coulomb’s law. 3.4 Testing for charge with electroscope. 3.5 Charging and discharging. 3.6 Separation of charges.', handsOn: 'A balloon rubbed so that it sticks to a wall or ceiling when released to demonstrate charging by friction.' },
                    ],
                },
                {
                    title: 'The coulomb',
                    lessons: [
                        { term: 2, week: 16, periods: 3, digital: false, title: '3.7 Conductors and insulators in relation to spreading of charge on charged objects.' },
                        { term: 2, week: 17, periods: 3, digital: false, title: '3.8 Force between charges. Positive and negative charges.' },
                        { term: 2, week: 17, periods: 0, digital: false, title: 'Application of electrostatics industrially eg photocopying, painting.' },
                        { term: 2, week: 18, periods: 3, entry: 'INTEGRATION', title: 'Activity of Integration / Evaluation / Correction and Remediation.' },
                    ],
                },
                {
                    title: 'Current Electricity',
                    lessons: [
                        { term: 2, week: 19, periods: 3, digital: false, title: '3.9 Introduction.', objectives: '3.10 Electricity and charge movement. Use of meters in electric circuits, how they are connected and reasons.' },
                    ],
                },
                {
                    title: 'Emf',
                    lessons: [
                        { term: 2, week: 20, periods: 3, digital: false, title: '3.11 Emf and pd sources of emf.' },
                    ],
                },
                {
                    title: 'Electric circuits',
                    lessons: [
                        { term: 2, week: 21, periods: 3, digital: false, title: '3.12 Energy consumption. W=QV and P=VI.', handsOn: 'Build simple electrical circuits with small torch bulbs of known resistances. Connect at least two bulbs in series or parallel and calculate their combined resistance.' },
                        { term: 2, week: 22, periods: 3, digital: false, title: '3.13 ELECTRIC CIRCUITS.', objectives: 'Components of a circuit network.' },
                        { term: 2, week: 23, periods: 3, digital: false, title: '3.14 Ohm’s law and Resistance.', objectives: '3.15 Circuit network. (No mention of Kirchhoff’s rules). Parallel and series connections. Calculations in circuits.' },
                        { term: 2, week: 24, periods: 3, entry: 'INTEGRATION', title: 'Activity of Integration / Evaluation / Correction and Remediation.' },
                    ],
                },
                {
                    title: 'Power in ac and dc',
                    lessons: [
                        { term: 3, week: 25, periods: 3, digital: false, title: '3.16 DC and AC, Definition. Transportation of electric current.', objectives: '3.17 Calculation of power dissipated.' },
                        { term: 3, week: 26, periods: 3, digital: false, title: '3.18 Calculation of power consumed at home (KWH).' },
                    ],
                },
                {
                    title: 'House wiring',
                    lessons: [
                        { term: 3, week: 27, periods: 3, digital: false, title: '3.19 House wiring, Ring circuit and linear circuit in house wiring.' },
                        { term: 3, week: 28, periods: 3, digital: false, title: '3.20 Fuse and selection, Safety precaution.' },
                    ],
                },
                {
                    title: 'CRO',
                    lessons: [
                        { term: 3, week: 29, periods: 3, digital: false, title: '3.21 The cathode ray oscilloscope.' },
                        { term: 3, week: 30, periods: 3, entry: 'INTEGRATION', title: 'Activity of Integration / Evaluation / Correction and Remediation.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE IV',
            title: 'PROJECTS AND ELEMENTARY ENGINEERING',
            chapters: [
                {
                    title: 'Technical Drawing',
                    lessons: [
                        { term: 3, week: 31, periods: 3, digital: false, title: 'Realization of a technical project.', objectives: '1 Technical drawing. 2 Reading of technical drawing.', handsOn: 'Draw a three dimensional diagram of a classroom containing the door and windows.' },
                    ],
                },
                {
                    title: 'Section view Building plans',
                    lessons: [
                        { term: 3, week: 32, periods: 3, digital: false, title: '1.2 Cross section of an Object.', objectives: 'List the various ways of viewing an object. e.g top-view.' },
                        { term: 3, week: 33, periods: 3, digital: false, title: 'Reading of the plan of a construction sheet.', objectives: 'Drawing and giving of dimensions of a building.' },
                    ],
                },
                {
                    title: 'End of Year',
                    lessons: [
                        { term: 3, week: 34, periods: 9, entry: 'REVISION', title: 'General Revision / End of Year Examination (weeks 34-36).' },
                    ],
                },
            ],
        },
    ],
};

/* ============================== FORM 5 (3 p/wk, 63 h) ====================== */

const FORM_5: SchemeData = {
    className: 'FORM 5',
    periodsPerWeek: 3,
    annualTeachingHours: 63,
    modules: [
        {
            code: 'Module 1',
            title: 'FIELDS: MAGNETIC FIELDS AND THEIR EFFECTS',
            chapters: [
                {
                    title: 'Introduction',
                    lessons: [
                        { term: 1, week: 1, periods: 0, title: 'First contact with students and presentation of scheme of work.' },
                    ],
                },
                {
                    title: 'Magnetic Field',
                    lessons: [
                        { term: 1, week: 1, periods: 3, digital: true, title: '1.0 Magnets. 1.1 Introduction to magnetism - magnetic and non-magnetic substances.', objectives: 'Identification of magnets.', handsOn: 'Use a magnetic compass to identify non-magnetic, magnets and ferromagnetic materials. Use iron filings to trace the magnetic field pattern round a magnet. Use a thread to hang a bar and use it to identify use to identify the earth’s magnetic North. Produce a solenoid using a nail and copper wire connected to battery and use it to pick up small magnetic materials. Move a bar magnet at different rates towards a coil connected to a bulb.' },
                        { term: 1, week: 2, periods: 3, digital: true, title: '1.2 Law of magnetism.', objectives: 'Applications of magnets. Making magnets and care for magnets. Hard and soft magnetic materials.' },
                        { term: 1, week: 3, periods: 3, digital: true, title: '1.3 Magnetic Field. 1.4 Magnetic flux pattern.', objectives: 'Defining magnetic flux. Drawing of magnetic field lines for; bar magnet, the earth and the horse-shoe magnet. Flux pattern around two poles of magnets near each other.' },
                    ],
                },
                {
                    title: 'Magnetic effect of current',
                    lessons: [
                        { term: 1, week: 4, periods: 3, digital: true, title: '1.5 Magnetic effect of current.', objectives: 'Magnetic field pattern of a straight conductor carrying current. Direction of field lines: current carrying solenoid and factors which affect field strength.' },
                        { term: 1, week: 5, periods: 3, digital: true, title: 'Force on a current carrying conductor placed in a magnetic field.', objectives: 'Factors which determine the size of the force. Principle of electric motor.' },
                        { term: 1, week: 6, periods: 3, entry: 'INTEGRATION', title: 'Activity of Integration / Evaluation / Correction and Remediation.' },
                    ],
                },
                {
                    title: 'Electromagnetic Induction and Alternating Current',
                    lessons: [
                        { term: 1, week: 7, periods: 3, digital: true, title: '1.6 Electromagnetic Induction. Introduction to electromagnetic induction.', objectives: 'Faraday’s law.' },
                        { term: 1, week: 8, periods: 3, digital: true, title: 'Lenz laws.', objectives: 'Conservation of energy.' },
                        { term: 1, week: 9, periods: 3, digital: true, title: '1.7 Alternating Current. Mutual inductance.' },
                        { term: 1, week: 10, periods: 3, digital: true, title: 'The transformer.', objectives: 'Energy losses and remedies. Turn ratio.' },
                        { term: 1, week: 11, periods: 3, digital: true, title: 'Efficiency.', objectives: 'Practical transformers and power transmission. Applications of transformers.' },
                        { term: 1, week: 12, periods: 3, entry: 'INTEGRATION', title: 'Activity of Integration / Evaluation / Correction and Remediation.' },
                    ],
                },
            ],
        },
        {
            code: 'MODULE 2',
            title: 'ENVIRONMENTAL PROTECTION: Modern Physics and basic electronics',
            chapters: [
                {
                    title: 'The Atom',
                    lessons: [
                        { term: 2, week: 13, periods: 3, digital: true, title: '2.0 The nuclear model of the atom.', objectives: 'The composition of the atom. The electron (Q=Ne).' },
                        { term: 2, week: 14, periods: 3, digital: true, title: '2.1 The nuclear model of the atom.', objectives: 'The composition of the atom. The electron (Q=Ne).' },
                    ],
                },
                {
                    title: 'The Nucleus',
                    lessons: [
                        { term: 2, week: 15, periods: 3, digital: true, title: '2.2 The Nucleus. Nuclear stability.', objectives: '2.3 Radioactivity and decay equations.' },
                        { term: 2, week: 15, periods: 0, entry: 'BREAK', title: 'CHRISTMAS BREAK' },
                    ],
                },
                {
                    title: 'Radioactivity',
                    lessons: [
                        { term: 2, week: 16, periods: 3, digital: true, title: '2.4 Radioactive decay. α, β and γ and their properties including behaviour in electric field, magnetic field and cloud chamber.' },
                        { term: 2, week: 17, periods: 3, digital: true, title: '2.5 The concept of half-life.', objectives: 'The importance and use of isotopes. Background radiation.' },
                        { term: 2, week: 18, periods: 3, entry: 'INTEGRATION', title: 'Activity of Integration / Evaluation / Correction and Remediation.' },
                        { term: 2, week: 19, periods: 3, digital: true, title: '2.6 Uses of radioactive isotopes: eg in medicine, agriculture.', objectives: '2.7 Safety and hazard of radioactivity.' },
                    ],
                },
                {
                    title: 'Basic electronics',
                    lessons: [
                        { term: 2, week: 20, periods: 3, digital: true, title: '2.8 Semiconductors.', objectives: 'Intrinsic and extrinsic. P-type and N-type. P-n junctions and rectification.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 3',
            title: 'MECHANICS',
            chapters: [
                {
                    title: 'Physical quantities',
                    lessons: [
                        { term: 2, week: 21, periods: 3, digital: false, title: '3.1 Vector and scalar physical quantities. 3.2 Forces.', objectives: 'Type of forces. Resolution of forces. Free body diagrams. Archimedes Principle.', handsOn: 'Use magnets to demonstrate non-contact forces. Pulling very fast an A4 paper on which an object has been placed to demonstrate Newton’s first law.' },
                        { term: 2, week: 22, periods: 3, digital: false, title: '3.3 Mass and weight. 3.4 Turning effect of forces.', objectives: 'Moments, couples and applications.' },
                    ],
                },
                {
                    title: 'Motion',
                    lessons: [
                        { term: 2, week: 23, periods: 3, digital: false, title: '3.5 Linear motion.', objectives: 'Distance, displacement, Speed, velocity, acceleration. Motion graphs.' },
                        { term: 2, week: 24, periods: 3, entry: 'INTEGRATION', title: 'Activity of Integration / Evaluation / Correction and Remediation.' },
                        { term: 3, week: 25, periods: 3, digital: false, title: '3.6 Uniform motion.', objectives: 'Equations of uniformly accelerated linear motion and simple calculations. Free fall and gravity. Experiment to determine g, by free fall.' },
                    ],
                },
                {
                    title: "Newton's law",
                    lessons: [
                        { term: 3, week: 26, periods: 3, digital: false, title: '3.7 Linear momentum.', objectives: 'Interaction and conservation of momentum. Principle of conservation of momentum and real life situations.' },
                        { term: 3, week: 27, periods: 3, digital: false, title: '3.8 Newton’s laws of motion.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 4',
            title: 'PROJECTS AND ELEMENTARY ENGINEERING',
            chapters: [
                {
                    title: 'Preservation of appliances',
                    lessons: [
                        { term: 3, week: 28, periods: 3, digital: false, title: 'Preservation and Maintenance of appliances.', handsOn: 'Dismantle an electric motor and re-assemble. Use the electric motor to pull a load.' },
                        { term: 3, week: 29, periods: 3, digital: false, title: 'The essential elements in a repair box.', objectives: 'Give the name, role and method of application.' },
                    ],
                },
                {
                    title: 'Maintenance of appliances',
                    lessons: [
                        { term: 3, week: 30, periods: 3, digital: false, title: 'Understand the labelling on appliances.' },
                        { term: 3, week: 31, periods: 3, digital: false, title: 'Techniques of dismantling and assembling of appliances (FOLI and LIFO techniques).' },
                    ],
                },
                {
                    title: 'End of Year',
                    lessons: [
                        { term: 3, week: 32, periods: 15, entry: 'REVISION', title: 'General Revision / End of Year Examination (weeks 32-36).' },
                    ],
                },
            ],
        },
    ],
};

/* ============================== LOWER SIXTH SCIENCE (8 p/wk, 270 h) ====== */
/*
 * LSS/USS PDFs run two module tracks in parallel (Mechanics/Matter track and
 * Energetics/Electrical track). We flatten to sequential modules while keeping
 * the parallel-column structure recoverable via module code prefixes.
 */

const LOWER_SIXTH_SCIENCE: SchemeData = {
    className: 'LOWER SIXTH SCIENCE',
    periodsPerWeek: 8,
    annualTeachingHours: 270,
    notes: 'PDF runs Module 1 (Mechanics/Matter) in parallel with Module 3 (Energetics/Electrical). Both tracks captured as sequential modules.',
    modules: [
        {
            code: 'Module 1',
            title: 'Physical quantities & Mechanics',
            chapters: [
                {
                    title: 'Introduction',
                    lessons: [
                        { term: 1, week: 1, periods: 2, digital: true, title: 'First contact with students and presentation of scheme of work / Advanced Level course outline.' },
                    ],
                },
                {
                    code: '1.1',
                    title: 'Physical quantities',
                    lessons: [
                        { term: 1, week: 1, periods: 2, digital: true, title: 'Physical quantities, base and derived physical quantities/units, SI units.' },
                        { term: 1, week: 2, periods: 4, digital: true, title: 'Dimensions, physical equations and homogeneity of physical equations.' },
                        { term: 1, week: 2, periods: 0, digital: true, title: 'Experimental physics. Experimental techniques, approach, accuracy, sensitivity error and precautions.' },
                    ],
                },
                {
                    code: '2.1',
                    title: 'Kinematics',
                    lessons: [
                        { term: 1, week: 3, periods: 4, digital: true, title: 'Motion, distance/displacement, speed/velocity, Linear momentum, acceleration.' },
                        { term: 1, week: 3, periods: 0, digital: true, title: 'Graphs of motion in one dimension and equations of uniformly accelerated motion.' },
                        { term: 1, week: 4, periods: 4, digital: true, title: 'Motion under gravity and experiment to measure acceleration due to gravity.' },
                        { term: 1, week: 4, periods: 4, digital: true, title: 'Projectile motion. **This could still be taught under motion in the gravitational field.' },
                    ],
                },
                {
                    code: '2.2',
                    title: 'Dynamics and force',
                    lessons: [
                        { term: 1, week: 5, periods: 4, digital: true, title: 'Meaning and nature of forces, types and classification. Centre of gravity, centre of mass, free-body diagrams and resultant of coplanar forces.' },
                        { term: 1, week: 5, periods: 0, digital: true, title: 'Turning effect of forces, moment and couples, integration exercise.' },
                        { term: 1, week: 6, periods: 4, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                        { term: 1, week: 7, periods: 4, digital: true, title: 'Equilibrium of objects acted upon by a number of coplanar forces.' },
                        { term: 1, week: 8, periods: 4, digital: true, title: 'Newton’s first and second Laws, impulse, experimental investigations of a∝F and a∝1/m.' },
                    ],
                },
                {
                    code: '2.3',
                    title: "Newton's Laws of motion and momentum",
                    lessons: [
                        { term: 1, week: 9, periods: 4, digital: true, title: 'Newton’s Third law of motion, the law of conservation of linear momentum from Newton’s second and third laws.' },
                        { term: 1, week: 10, periods: 4, digital: true, title: 'Law of conservation and experiment to investigate the law of conservation of linear momentum.' },
                        { term: 1, week: 11, periods: 4, digital: true, title: 'Elastic and inelastic collisions.' },
                        { term: 1, week: 11, periods: 0, digital: true, title: 'Explosions, head-on and oblique collisions.' },
                        { term: 1, week: 12, periods: 4, entry: 'INTEGRATION', title: 'Integration Exercises and Evaluation.' },
                    ],
                },
                {
                    code: '2.4',
                    title: 'Work, energy and power',
                    lessons: [
                        { term: 2, week: 13, periods: 4, digital: true, title: 'Work, potential energy and kinetic, Law of conservation of mechanical energy.' },
                        { term: 2, week: 14, periods: 4, digital: true, title: 'Work-kinetic energy theorem, efficiency, power.' },
                    ],
                },
                {
                    code: '2.5',
                    title: 'Circular motion',
                    lessons: [
                        { term: 2, week: 15, periods: 4, digital: true, title: 'Period and frequency, angular speed and velocity, centripetal acceleration and centripetal force, consolidation examples.' },
                        { term: 2, week: 15, periods: 0, entry: 'BREAK', title: 'CHRISTMAS BREAK' },
                        { term: 2, week: 16, periods: 4, digital: false, title: 'Motion in a vertical circle, the conical pendulum, cornering and banking.' },
                    ],
                },
                {
                    code: '2.6',
                    title: 'Simple harmonic motion',
                    lessons: [
                        { term: 2, week: 17, periods: 4, digital: true, title: 'Meaning and equations.' },
                        { term: 2, week: 18, periods: 4, entry: 'EVALUATION', title: 'HARMONISED EVALUATION' },
                        { term: 2, week: 19, periods: 4, digital: false, title: 'Energy changes in simple harmonic motion, examples of simple harmonic oscillators.' },
                        { term: 2, week: 20, periods: 4, digital: false, title: 'Mechanical oscillations and resonance.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 3',
            title: 'Energetics (parallel track)',
            chapters: [
                {
                    title: 'Introduction',
                    lessons: [
                        { term: 1, week: 1, periods: 2, digital: true, title: 'First contact with students and presentation of scheme of work / Advanced Level course outline.' },
                    ],
                },
                {
                    code: '3.1',
                    title: 'Temperature',
                    lessons: [
                        { term: 1, week: 2, periods: 2, digital: true, title: 'Thermal equilibrium, zeroth law and thermometric properties.' },
                        { term: 1, week: 2, periods: 0, digital: true, title: 'Temperature measurement, temperature scales and disagreement between temperature scales.' },
                        { term: 1, week: 3, periods: 2, digital: true, title: 'Different types of thermometers.' },
                        { term: 1, week: 3, periods: 0, digital: true, title: 'Different types of thermometers (continued).' },
                    ],
                },
                {
                    code: '3.2',
                    title: 'Energy Transfer',
                    lessons: [
                        { term: 1, week: 4, periods: 2, digital: true, title: 'Heat capacity and specific heat capacity.' },
                        { term: 1, week: 4, periods: 0, digital: true, title: 'Experiments to measure specific heat capacity.' },
                        { term: 1, week: 5, periods: 2, digital: true, title: 'Latent heat and specific latent heat.' },
                        { term: 1, week: 5, periods: 0, digital: true, title: 'Experiments to measure specific latent heat of fusion and specific latent heat of vaporization.' },
                        { term: 1, week: 6, periods: 2, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                        { term: 1, week: 7, periods: 2, digital: true, title: 'Heating and cooling curves, integration exercises.' },
                        { term: 1, week: 8, periods: 2, digital: true, title: 'Thermal conduction and mechanism, temperature gradient.' },
                        { term: 1, week: 9, periods: 2, digital: true, title: 'Thermal conductivity.' },
                        { term: 1, week: 10, periods: 2, digital: false, title: 'Comparing electrical conduction to thermal conduction, experiment to compare thermal conductivity of different materials.' },
                        { term: 1, week: 11, periods: 2, digital: true, title: 'Thermal convection and radiation, mechanisms.' },
                    ],
                },
                {
                    code: '3.3',
                    title: 'Electrical energy',
                    lessons: [
                        { term: 1, week: 11, periods: 0, digital: true, title: 'Electric current, electric potential difference, drift velocity.' },
                        { term: 1, week: 12, periods: 2, entry: 'INTEGRATION', title: 'Integration Exercises and Evaluation.' },
                        { term: 2, week: 13, periods: 2, digital: true, title: 'Electrical resistance, resistor colour codes, Ohm’s Law and resistivity.' },
                        { term: 2, week: 14, periods: 2, digital: true, title: 'Experiment to determine resistivity, temperature coefficient of resistance.' },
                        { term: 2, week: 15, periods: 2, digital: false, title: 'Resistor networks and the potential divider.' },
                        { term: 2, week: 15, periods: 0, entry: 'BREAK', title: 'CHRISTMAS BREAK' },
                        { term: 2, week: 16, periods: 2, digital: false, title: 'Ideal and non-ideal ammeters and voltmeters in circuit.' },
                        { term: 2, week: 17, periods: 2, digital: false, title: 'Electromotive force, terminal p.d. and internal resistance.' },
                        { term: 2, week: 18, periods: 4, entry: 'EVALUATION', title: 'HARMONISED EVALUATION' },
                        { term: 2, week: 19, periods: 2, digital: false, title: 'Kirchhoff’s Laws.' },
                        { term: 2, week: 20, periods: 2, digital: false, title: 'Potentiometer.' },
                        { term: 2, week: 21, periods: 2, digital: false, title: 'Wheatstone bridge circuit, consolidation exercises.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 4',
            title: 'Matter, effects of energy and application',
            chapters: [
                {
                    code: '4.1',
                    title: 'Solids and liquids',
                    lessons: [
                        { term: 2, week: 21, periods: 4, digital: false, title: 'Differences in the molecular properties of solids, liquids and gases, molecular spacing, intermolecular force vs separation curves, potential energy vs separation curves.' },
                        { term: 2, week: 22, periods: 4, digital: false, title: 'Elasticity and Young modulus energy stored in a stretched wire.' },
                        { term: 2, week: 23, periods: 4, digital: false, title: 'Experiment to determine Young Modulus, consolidation exercises.' },
                        { term: 2, week: 24, periods: 4, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                        { term: 3, week: 25, periods: 4, digital: false, title: 'Surface tension and capillarity, Angle of contact, experiment to measure surface tension of water.' },
                    ],
                },
                {
                    code: '4.2',
                    title: 'Gases and thermodynamics',
                    lessons: [
                        { term: 3, week: 26, periods: 4, digital: false, title: 'Brownian motion in gases, gas laws and the ideal gas equation.' },
                        { term: 3, week: 27, periods: 4, digital: false, title: 'Kinetic theory of ideal gases, derivation of P = ⅓ρc̄² and k.e. = ½mc̄² = ⅔kT.', objectives: 'Distribution of molecular speeds, Real gases and Andrew’s experiment.' },
                        { term: 3, week: 28, periods: 4, digital: false, title: 'First law of thermodynamics; isochoric, isobaric, isothermal and adiabatic processes.' },
                        { term: 3, week: 29, periods: 4, digital: false, title: 'Second law of thermodynamics, basic function of heat engines, entropy, Consolidation examples.' },
                    ],
                },
            ],
        },
        {
            code: 'Option 1',
            title: 'Energy Resources and Environmental Physics (parallel track)',
            chapters: [
                {
                    code: '3.4',
                    title: 'Energy resources and environmental Physics',
                    lessons: [
                        { term: 2, week: 22, periods: 2, digital: false, title: 'Classification of energy sources, functional energy, efficiency of conversion.' },
                        { term: 2, week: 23, periods: 2, digital: false, title: 'Hydroelectricity and wind energy.' },
                        { term: 2, week: 24, periods: 2, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                        { term: 3, week: 25, periods: 2, digital: false, title: 'Solar energy and tidal energy.' },
                        { term: 3, week: 26, periods: 2, digital: false, title: 'Biomass, geothermal energy and wave energy.' },
                        { term: 3, week: 27, periods: 2, digital: false, title: 'Fossil fuels and nuclear fuel.' },
                        { term: 3, week: 28, periods: 2, digital: false, title: 'Simple structure of the atmosphere, ozonosphere and the ionosphere, destruction of the ozone layer.' },
                        { term: 3, week: 29, periods: 2, digital: false, title: 'Greenhouse effect, global warming and climate change.' },
                    ],
                },
                {
                    title: 'End of Year',
                    lessons: [
                        { term: 3, week: 29, periods: 0, entry: 'BREAK', title: 'EASTER BREAK' },
                        { term: 3, week: 30, periods: 10, entry: 'REVISION', title: 'General Revision and End of Year Evaluation (weeks 30-36).' },
                    ],
                },
            ],
        },
    ],
};

/* ============================== UPPER SIXTH SCIENCE (8 p/wk, 270 h) ====== */

const UPPER_SIXTH_SCIENCE: SchemeData = {
    className: 'UPPER SIXTH SCIENCE',
    periodsPerWeek: 8,
    annualTeachingHours: 270,
    notes: 'PDF runs Module 5 (Field Phenomena) in parallel with Module 6 (Waves) plus Options 2-4. Both tracks captured as sequential modules.',
    modules: [
        {
            code: 'Module 5',
            title: 'Field Phenomena',
            chapters: [
                {
                    title: 'Introduction',
                    lessons: [
                        { term: 1, week: 1, periods: 2, digital: true, title: 'First contact with students and presentation of scheme of work / USS course outline. Newton’s law of universal gravitation and inverse square relation.' },
                    ],
                },
                {
                    code: '5.1',
                    title: 'Gravitational Fields',
                    lessons: [
                        { term: 1, week: 1, periods: 4, digital: true, title: 'Kepler’s laws, Qualitative description of the Earth’s gravitational field. Field Strength.' },
                        { term: 1, week: 2, periods: 4, digital: true, title: 'Variation of g inside and outside the Earth.', objectives: 'Gravitational potential and gravitational potential energy.' },
                        { term: 1, week: 3, periods: 4, digital: true, title: 'Escape velocity. Orbital speed and geostationary satellites. Orbital speed and movement of satellites with geostationary satellites as example.' },
                        { term: 1, week: 4, periods: 4, digital: true, title: 'Motion in the gravitational field: Projectile motion. **Check if this was not treated under mechanics in LSS.' },
                    ],
                },
                {
                    title: 'Electrostatics + Electric Fields',
                    lessons: [
                        { term: 1, week: 5, periods: 4, digital: true, title: 'Electric charge and current. Good and bad conductors of electricity. Charging by friction, contact, induction and by chemical action. Point action and the lightening conductor.' },
                        { term: 1, week: 6, periods: 4, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                        { term: 1, week: 7, periods: 4, digital: true, title: 'Coulomb’s law and inverse square nature. Dependence of force on medium. Electric field and field strength.' },
                        { term: 1, week: 8, periods: 4, digital: true, title: 'Electric potential and work done in moving a charge in an electric field. Electric field dipole and torque.' },
                    ],
                },
                {
                    title: 'Capacitors',
                    lessons: [
                        { term: 1, week: 9, periods: 4, digital: true, title: 'Identification of capacitors and circuit symbols. Measurement of capacitance. Factors which affect capacitance. Relative permittivity.' },
                        { term: 1, week: 10, periods: 4, digital: true, title: 'Combination of capacitors (series & parallel). Energy/charge stored in a different combinations of capacitors connected to a dc power supply.' },
                        { term: 1, week: 11, periods: 4, digital: true, title: 'Charging and discharging capacitors through resistors and time constant. The equations for charging/discharging and interpretations at t=0 and as t → ∞.' },
                        { term: 1, week: 12, periods: 4, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                    ],
                },
                {
                    code: '5.4',
                    title: 'Magnetic Fields',
                    lessons: [
                        { term: 2, week: 13, periods: 4, digital: true, title: 'The magnetic field. Magnetic flux density and its units (the tesla).' },
                        { term: 2, week: 13, periods: 0, digital: true, title: 'Field patterns of current-carrying conductors (straight wire, plane circular coil, solenoid). Force on a current-carrying conductor in a uniform magnetic field. The direction of the force from Fleming’s left hand rule.' },
                        { term: 2, week: 14, periods: 4, digital: false, title: 'Forces on objects in cross-fields. Torque on a rectangular coil within a uniform magnetic field (T = NAIB). The principle of the electric motor (dc and ac types).' },
                        { term: 2, week: 15, periods: 4, digital: false, title: 'Biot-Savart law. Ampere’s law. Magnetic flux density within a long solenoid, long straight wire, and plane circular coil (B = μ₀nI, B = μ₀I/2r, B = μ₀I/2πr). Force between two current-carrying conductors.' },
                        { term: 2, week: 15, periods: 0, entry: 'BREAK', title: 'CHRISTMAS BREAK' },
                    ],
                },
                {
                    title: 'Electromagnetic Induction',
                    lessons: [
                        { term: 2, week: 16, periods: 4, digital: false, title: 'Force on a moving charge in uniform magnetic field. Measurement of specific charge (e/m₀). The Hall effect. Dia-, para- and ferro-magnetic materials. Magnetic Shielding. The Lorentz force.' },
                        { term: 2, week: 17, periods: 4, digital: false, title: 'Faraday’s and Lenz’s laws of electromagnetic induction. Induced e.m.f. across a conductor moving with velocity v, through uniform magnetic field. Simple DC and AC generator principles.' },
                        { term: 2, week: 18, periods: 4, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                    ],
                },
                {
                    title: 'Electromagnetic Induction + Alternating Current',
                    lessons: [
                        { term: 2, week: 19, periods: 4, digital: true, title: 'Meaning of self-inductance and mutual inductance. The L-R DC circuit (the growth and decay of current). Energy stored in an inductor. Coefficient M and L should be understood to be defined as the constants in the equations: Nϕ = LI, Nϕ₂ = MI₁ and Nϕ₁ = MI₂.' },
                        { term: 2, week: 20, periods: 4, digital: false, title: 'Theory of transformers. Knowledge, understanding but not derivation of Vp/Vs = Np/Ns = Is/Ip for ideal transformers. Sources of power losses for practical transformers and how each is minimized.' },
                        { term: 2, week: 21, periods: 4, digital: false, title: 'Root-mean-square values. Impedance and resonance. Use of f₀ = 1/(2π√(LC)).' },
                        { term: 2, week: 22, periods: 4, digital: false, title: 'Power in a.c. Circuits. Rectification of ac signals and Smoothening.' },
                    ],
                },
                {
                    title: 'The atom, the nucleus of the atom',
                    lessons: [
                        { term: 2, week: 23, periods: 4, digital: false, title: 'The atom, Rutherford’s alpha scattering experiment and atomic model.' },
                        { term: 2, week: 24, periods: 4, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                    ],
                },
                {
                    title: 'Radioactivity',
                    lessons: [
                        { term: 3, week: 25, periods: 4, digital: false, title: 'Nuclear stability and radioactivity. Properties of radiations and applications.' },
                        { term: 3, week: 26, periods: 4, digital: false, title: 'Mass defect in nuclear processes and relation to energy. Nuclear fission and fusion.' },
                    ],
                },
            ],
        },
        {
            code: 'Module 6',
            title: 'Waves around us (parallel track)',
            chapters: [
                {
                    title: 'Introduction',
                    lessons: [
                        { term: 1, week: 1, periods: 2, title: 'First contact with students and presentation of scheme of work / USS course outline. 6.1 MECHANICAL WAVES: Classification of Waves: mode of propagation and medium of propagation with specific examples.' },
                    ],
                },
                {
                    code: '6.1',
                    title: 'MECHANICAL WAVES',
                    lessons: [
                        { term: 1, week: 2, periods: 2, digital: true, title: 'The progressive wave and equation. Graphical representation of waves.' },
                        { term: 1, week: 3, periods: 2, digital: true, title: 'Properties of Waves. Production of waves, reflection, refraction, diffraction: Interference. Single slit pattern.' },
                        { term: 1, week: 4, periods: 2, digital: false, title: 'Double slits and multiple slits interference patterns and measurement of wavelength of a wave.' },
                        { term: 1, week: 5, periods: 2, digital: false, title: 'Properties of Waves: Polarization - meaning and production of plane polarized em waves.' },
                        { term: 1, week: 6, periods: 2, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                        { term: 1, week: 7, periods: 2, digital: false, title: 'The factors affecting the speed of transverse waves on taut strings and wires.' },
                        { term: 1, week: 8, periods: 4, digital: true, title: 'Doppler Effect for Sound in air with specific cases of moving source/stationary observer and moving observer with stationary source.' },
                        { term: 1, week: 9, periods: 2, digital: true, title: 'Stationary waves and characteristics.' },
                        { term: 1, week: 10, periods: 2, digital: false, title: 'Measurement of the speed of sound in air.' },
                        { term: 1, week: 11, periods: 2, digital: true, title: 'Electromagnetic waves and their characteristics. EM-spectrum; production, detection and uses of different sections.' },
                        { term: 1, week: 12, periods: 2, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                    ],
                },
                {
                    code: '3.2',
                    title: 'X-rays and Optics',
                    lessons: [
                        { term: 2, week: 13, periods: 2, digital: false, title: 'X-rays, production and uses. Meaning and application of accompanying phenomena.' },
                        { term: 2, week: 14, periods: 2, digital: false, title: 'Light sources. Optical transmission grating with normal incidence.' },
                        { term: 2, week: 15, periods: 2, digital: false, title: 'Multiple slit diffraction. Reflection and refraction at plane interfaces.' },
                        { term: 2, week: 15, periods: 0, entry: 'BREAK', title: 'CHRISTMAS BREAK' },
                        { term: 2, week: 16, periods: 2, digital: true, title: 'Laws of refraction. Refractive index.' },
                    ],
                },
                {
                    code: '3',
                    title: 'Dispersion & Lenses',
                    lessons: [
                        { term: 2, week: 17, periods: 2, digital: true, title: 'Dispersion. Total internal reflection and critical angle. Lenses: principal focus, focal length.' },
                        { term: 2, week: 18, periods: 4, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                        { term: 2, week: 19, periods: 2, digital: true, title: 'Familiarity with practical situations in which a single converging lens produces a magnified or diminished image, dioptre. Prisms, optical instruments eg compound microscopes and Astronomical telescopes.' },
                        { term: 2, week: 20, periods: 2, digital: false, title: 'Conservation of energy for waves in free space from a point source. Inverse square law.' },
                        { term: 2, week: 21, periods: 2, digital: false, title: 'Photoelectric effect. The photons, Plank constant.' },
                        { term: 2, week: 22, periods: 2, digital: false, title: 'Einstein’s photoelectric equation. Wave-particle duality.' },
                    ],
                },
                {
                    code: '3.3',
                    title: 'Atomic spectra',
                    lessons: [
                        { term: 2, week: 23, periods: 2, digital: false, title: 'Emission and absorption spectra. Energy levels. The electron volt.' },
                        { term: 2, week: 24, periods: 2, entry: 'REVISION', title: 'REVISION AND EVALUATION' },
                    ],
                },
                {
                    code: '3.3E',
                    title: 'Schrodinger model',
                    lessons: [
                        { term: 3, week: 25, periods: 2, digital: false, title: 'Use of equation E = hf = E₂ - E₁. The Schrodinger model of the hydrogen atom.' },
                    ],
                },
            ],
        },
        {
            code: 'Option 2',
            title: 'Communication',
            chapters: [
                {
                    title: 'Radio waves and Aerials',
                    lessons: [
                        { term: 3, week: 26, periods: 2, digital: false, title: 'Representing information: Analogue method, digital method, advantages and disadvantages. Radio waves: Surface or ground wave.' },
                        { term: 3, week: 27, periods: 2, digital: false, title: 'Sky wave, space wave. Aerials: transmitting, receiving aerials. Tuning circuit, its resonance curve.' },
                    ],
                },
                {
                    code: '3.4',
                    title: 'Transmission of information',
                    lessons: [
                        { term: 3, week: 28, periods: 2, digital: false, title: 'Transmission of information: modulation, demodulation. Amplitude modulation (AM), frequency modulation (FM), advantages and disadvantages of each over the other.' },
                        { term: 3, week: 29, periods: 2, digital: false, title: 'Analogue and digital signals. Analogue to Digital converters. Digital to Analogue converters. Advantages of each over the other.' },
                        { term: 3, week: 30, periods: 2, digital: false, title: 'Main parts. Communication Channels: band width, sidebands, use of satellite for communication. Base station and their role.' },
                    ],
                },
            ],
        },
        {
            code: 'Option 3',
            title: 'Electronics',
            chapters: [
                {
                    title: 'Thermionic emission & Semiconductors',
                    lessons: [
                        { term: 3, week: 27, periods: 4, digital: true, title: 'Thermionic emission and the electron gun.' },
                        { term: 3, week: 28, periods: 4, digital: false, title: 'Semiconductors and doping. The p-n junction diode, biasing and applications.' },
                        { term: 3, week: 29, periods: 4, digital: false, title: 'The transistor. Logic gates and amplifiers.' },
                    ],
                },
            ],
        },
        {
            code: 'Option 4',
            title: 'Medical Physics',
            chapters: [
                {
                    title: 'Vision, Hearing & Imaging',
                    lessons: [
                        { term: 3, week: 30, periods: 4, digital: false, title: 'The physics of vision and defects. Hearing and defects.' },
                        { term: 3, week: 31, periods: 4, digital: false, title: 'Biological Measurements for the heart. Imaging in medical diagnosis (Non-ionising methods).' },
                        { term: 3, week: 32, periods: 4, digital: false, title: 'Ionizing technics in imaging for medical diagnosis. Use of optical fibres in medical procedures.' },
                    ],
                },
                {
                    title: 'End of Year',
                    lessons: [
                        { term: 3, week: 33, periods: 12, entry: 'REVISION', title: 'GENERAL REVISION (weeks 33-36).' },
                    ],
                },
            ],
        },
    ],
};

/* ============================== SEED ENGINE =============================== */

const ALL_SCHEMES: SchemeData[] = [
    FORM_1,
    FORM_2,
    FORM_3,
    FORM_4,
    FORM_5,
    LOWER_SIXTH_SCIENCE,
    UPPER_SIXTH_SCIENCE,
];

async function resolveTermIds(academicYearId: number): Promise<Record<Term, number>> {
    const terms = await prisma.term.findMany({
        where: { academic_year_id: academicYearId },
        orderBy: { start_date: 'asc' },
    });

    const byName = (needle: string) =>
        terms.find(t => t.name.toLowerCase().includes(needle))?.id;

    const first = byName('first');
    const second = byName('second');
    const third = byName('third');

    if (!first || !second || !third) {
        throw new Error(
            `Missing terms for academic year ${academicYearId}. Found: ${terms
                .map(t => t.name)
                .join(', ')}`,
        );
    }

    return { 1: first, 2: second, 3: third };
}

async function seedScheme(
    scheme: SchemeData,
    ctx: {
        subjectId: number;
        academicYearId: number;
        createdById: number;
        termIds: Record<Term, number>;
    },
) {
    const classRow = await prisma.class.findFirst({
        where: { name: scheme.className },
    });

    if (!classRow) {
        console.warn(`  [skip] Class not found: ${scheme.className}`);
        return;
    }

    // Idempotency: purge any existing scheme for this (subject, class, year).
    await prisma.subjectScheme.deleteMany({
        where: {
            subject_id: ctx.subjectId,
            class_id: classRow.id,
            academic_year_id: ctx.academicYearId,
        },
    });

    const created = await prisma.subjectScheme.create({
        data: {
            subject_id: ctx.subjectId,
            class_id: classRow.id,
            academic_year_id: ctx.academicYearId,
            periods_per_week: scheme.periodsPerWeek,
            annual_teaching_hours: scheme.annualTeachingHours,
            notes: scheme.notes,
            created_by_id: ctx.createdById,
            modules: {
                create: scheme.modules.map((mod, mIdx) => ({
                    order: mIdx + 1,
                    code: mod.code,
                    title: mod.title,
                    chapters: {
                        create: mod.chapters.map((chap, cIdx) => ({
                            order: cIdx + 1,
                            code: chap.code,
                            title: chap.title,
                            lessons: {
                                create: chap.lessons.map((lsn, lIdx) => ({
                                    order: lIdx + 1,
                                    entry_type: lsn.entry ?? 'LESSON',
                                    title: lsn.title,
                                    objectives: lsn.objectives,
                                    hands_on_activities: lsn.handsOn,
                                    digital_resource_available: lsn.digital ?? false,
                                    term_id: ctx.termIds[lsn.term],
                                    week_number: lsn.week,
                                    periods_count: lsn.periods,
                                })),
                            },
                        })),
                    },
                })),
            },
        },
        include: { _count: { select: { modules: true } } },
    });

    const lessonCount = scheme.modules.reduce(
        (sum, m) => sum + m.chapters.reduce((s, c) => s + c.lessons.length, 0),
        0,
    );
    console.log(
        `  [ok]   ${scheme.className.padEnd(22)} scheme #${created.id}: ` +
            `${created._count.modules} modules, ${lessonCount} lessons`,
    );
}

async function main() {
    console.log('=== Physics scheme-of-work seeder ===');

    const subject = await prisma.subject.findFirst({ where: { name: 'Physics' } });
    if (!subject) throw new Error('Subject "Physics" not found');

    const currentYear = await prisma.academicYear.findFirst({
        where: { is_current: true },
    });
    if (!currentYear) throw new Error('No current academic year found');

    const creator = await prisma.user.findFirst({
        where: { user_roles: { some: { role: 'SUPER_MANAGER' } } },
    });
    if (!creator) throw new Error('No SUPER_MANAGER user found to attribute creation');

    const termIds = await resolveTermIds(currentYear.id);

    console.log(
        `Subject: ${subject.name} (#${subject.id})  |  Year: ${currentYear.name} (#${currentYear.id})  |  Creator: ${creator.name} (#${creator.id})`,
    );
    console.log('');

    for (const scheme of ALL_SCHEMES) {
        await seedScheme(scheme, {
            subjectId: subject.id,
            academicYearId: currentYear.id,
            createdById: creator.id,
            termIds,
        });
    }

    console.log('');
    console.log('Done.');
}

main()
    .catch(err => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
