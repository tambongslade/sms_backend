/**
 * @swagger
 * components:
 *   schemas:
 *     PaymentMethod:
 *       type: string
 *       enum: [EXPRESS_UNION, CCA, F3DC, AFRILAND_FIRST_BANK]
 *       description: Method used for making payments
 *
 *     Audience:
 *       type: string
 *       enum: [INTERNAL, EXTERNAL, BOTH]
 *       description: Target audience for announcements
 *
 *     NotificationStatus:
 *       type: string
 *       enum: [SENT, DELIVERED, READ]
 *       description: Status of a mobile notification
 *
 *     QuestionType:
 *       type: string
 *       enum: [MCQ, LONG_ANSWER]
 *       description: Type of exam question
 *
 *     Role:
 *       type: string
 *       enum: [SUPER_MANAGER, MANAGER, PRINCIPAL, VICE_PRINCIPAL, BURSAR, CONTROLLER, TEACHER, HOD, DISCIPLINE_MASTER, SENIOR_DISCIPLINE_MASTER, DEAN_OF_DISCIPLINE, DISCIPLINE_COORDINATOR, DEAN_OF_STUDIES, FEE_AUDITOR, SECRETARY, NURSE, GUIDANCE_COUNSELOR, PARENT]
 *       description: User role in the school system
 *
 *     AssignmentRole:
 *       type: string
 *       enum: [PRINCIPAL, VICE_PRINCIPAL, DISCIPLINE_MASTER, SENIOR_DISCIPLINE_MASTER, DEAN_OF_DISCIPLINE, DISCIPLINE_COORDINATOR, DEAN_OF_STUDIES, FEE_AUDITOR, SECRETARY, NURSE, BURSAR, CONTROLLER, HOD]
 *       description: Assignable school-position role
 *
 *     DayOfWeek:
 *       type: string
 *       enum: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY]
 *       description: Day of the week
 *
 *     Gender:
 *       type: string
 *       enum: [Female, Male]
 *       description: Gender of a person
 *
 *     SubjectCategory:
 *       type: string
 *       enum: [SCIENCE_AND_TECHNOLOGY, LANGUAGES_AND_LITERATURE, HUMAN_AND_SOCIAL_SCIENCE, OTHERS]
 *       description: Category of academic subject
 *
 *     AverageStatus:
 *       type: string
 *       enum: [PENDING, CALCULATED, VERIFIED]
 *       description: Status of a student's average calculation
 *
 *     HealthCondition:
 *       type: string
 *       enum: [SICKLE_CELL, ASTHMATIC, EPILEPTIC, DIABETIC, ALLERGY, HYPERTENSION, OTHER]
 *       description: Predefined student medical condition
 *
 *     MakeupStatus:
 *       type: string
 *       enum: [NONE, PENDING, COMPLETED, WAIVED]
 *       description: Status of a student's academic makeup for an absence
 *
 *     SummonsTrigger:
 *       type: string
 *       enum: [CONSECUTIVE_ABSENCES, CUMULATIVE_ABSENCES, MANUAL]
 *       description: What caused a parent summons to be created
 *
 *     SummonsStatus:
 *       type: string
 *       enum: [PENDING, SCHEDULED, COMPLETED, MISSED, CANCELLED]
 *       description: Lifecycle state of a parent summons
 *
 *     RollCallSlot:
 *       type: string
 *       enum: [SLOT_2, SLOT_5, SLOT_8]
 *       description: DM roll-call slot (after 2nd, 5th, or 8th period)
 *
 *     DMRollCallStatus:
 *       type: string
 *       enum: [PRESENT, LATE, ABSENT]
 *       description: Attendance status recorded during a DM roll call
 *
 *     WarningReason:
 *       type: string
 *       enum: [CUMULATIVE_ABSENCES, CHRONIC_LATENESS, MISCONDUCT, OTHER]
 *       description: Category of the discipline warning issued to a student
 *
 *     DisciplineType:
 *       type: string
 *       enum: [MORNING_LATENESS, CLASS_ABSENCE, MISCONDUCT, BROKEN_PROPERTY, FIGHTING, THEFT, VANDALISM, DISRUPTION, DRUG_POSSESSION, WEAPON_POSSESSION, CHEATING, OTHER]
 *       description: Category of a discipline issue
 */

export { };