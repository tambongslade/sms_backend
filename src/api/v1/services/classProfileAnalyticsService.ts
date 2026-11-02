import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';

export interface ClassProfileOverview {
  classId: number;
  className: string;
  totalStudents: number;
  totalSubclasses: number;
  academicPerformance: {
    averageGrade: number;
    topPerformer: any;
    bottomPerformer: any;
    passRate: number;
    aboveAverageCount: number;
    belowAverageCount: number;
  };
  demographics: {
    maleCount: number;
    femaleCount: number;
    averageAge: number;
    newStudents: number;
    repeaters: number;
  };
  attendance: {
    averageAttendanceRate: number;
    chronicAbsentees: number;
    perfectAttendance: number;
  };
  finances: {
    totalFeesExpected: number;
    totalFeesCollected: number;
    collectionRate: number;
    outstandingAmount: number;
    overpaymentAmount: number;
    defaulters: number;
  };
  discipline: {
    totalIncidents: number;
    resolvedIncidents: number;
    pendingIncidents: number;
    studentsWithIssues: number;
  };
  teachers: {
    totalTeachers: number;
    averageTeacherRating: number;
    subjectsOffered: number;
    teacherAttendanceRate: number;
  };
}

export interface ClassComparison {
  class1: ClassProfileOverview;
  class2: ClassProfileOverview;
  comparisons: {
    academicPerformance: any;
    attendance: any;
    finances: any;
    discipline: any;
  };
}

export interface ClassTrendAnalysis {
  classId: number;
  trends: {
    academicTrends: any[];
    attendanceTrends: any[];
    financialTrends: any[];
    disciplineTrends: any[];
  };
  predictions: {
    nextMonthPerformance: number;
    nextMonthAttendance: number;
    nextMonthCollection: number;
  };
}

// Get comprehensive class profile analytics
export async function getClassProfileAnalytics(
  classId: number,
  academicYearId?: number
): Promise<ClassProfileOverview> {
  try {
    const currentAcademicYearId = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentAcademicYearId) {
      throw new Error('No academic year found');
    }

    // Get class basic info
    const classInfo = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        sub_classes: {
          include: {
            enrollments: {
              // Same population rule as feeOutstandingService.ts (M8): withdrawn
              // students excluded from every fee report/dashboard.
              where: { academic_year_id: currentAcademicYearId, student: { status: { not: 'WITHDRAWN' } } },
              include: {
                student: true,
                marks: true,
                school_fees: true,
                discipline_issues: true,
                absences: true
              }
            }
          }
        }
      }
    });

    if (!classInfo) {
      throw new Error('Class not found');
    }

    // Get all enrollments for this class
    const allEnrollments = classInfo.sub_classes.flatMap(sc => sc.enrollments);
    const totalStudents = allEnrollments.length;

    // Calculate academic performance
    const academicPerformance = await calculateAcademicPerformance(allEnrollments);

    // Calculate demographics
    const demographics = await calculateDemographics(allEnrollments);

    // Calculate attendance
    const attendance = await calculateAttendanceMetrics(allEnrollments);

    // Calculate finances
    const finances = await calculateFinancialMetrics(allEnrollments);

    // Calculate discipline
    const discipline = await calculateDisciplineMetrics(allEnrollments);

    // Calculate teacher metrics
    const teachers = await calculateTeacherMetrics(classId, currentAcademicYearId);

    return {
      classId,
      className: classInfo.name,
      totalStudents,
      totalSubclasses: classInfo.sub_classes.length,
      academicPerformance,
      demographics,
      attendance,
      finances,
      discipline,
      teachers
    };
  } catch (error: any) {
    throw new Error(`Failed to get class profile analytics: ${error.message}`);
  }
}

// Calculate academic performance metrics
async function calculateAcademicPerformance(enrollments: any[]): Promise<any> {
  try {
    const allMarks = enrollments.flatMap(e => e.marks || []);

    if (allMarks.length === 0) {
      return {
        averageGrade: 0,
        topPerformer: null,
        bottomPerformer: null,
        passRate: 0,
        aboveAverageCount: 0,
        belowAverageCount: 0
      };
    }

    // Calculate average grade
    const validMarks = allMarks.filter(m => m.score !== null);
    const averageGrade = validMarks.length > 0
      ? validMarks.reduce((sum: number, mark: any) => sum + mark.score, 0) / validMarks.length
      : 0;

    // Get student averages
    const studentAverages = enrollments.map(enrollment => {
      const studentMarks = enrollment.marks || [];
      const validStudentMarks = studentMarks.filter((m: any): m is typeof m & {score: number} => m.score !== null);
      const studentAverage = validStudentMarks.length > 0
        ? validStudentMarks.reduce((sum: number, mark: any) => sum + mark.score, 0) / validStudentMarks.length
        : 0;

      return {
        student: enrollment.student,
        average: studentAverage,
        totalMarks: validStudentMarks.length
      };
    }).filter(s => s.totalMarks > 0);

    // Sort by average
    studentAverages.sort((a, b) => b.average - a.average);

    const topPerformer = studentAverages.length > 0 ? studentAverages[0] : null;
    const bottomPerformer = studentAverages.length > 0 ? studentAverages[studentAverages.length - 1] : null;

    // Calculate pass rate (assuming 50% is passing)
    const passRate = studentAverages.length > 0
      ? (studentAverages.filter(s => s.average >= 50).length / studentAverages.length) * 100
      : 0;

    const aboveAverageCount = studentAverages.filter(s => s.average >= averageGrade).length;
    const belowAverageCount = studentAverages.filter(s => s.average < averageGrade).length;

    return {
      averageGrade,
      topPerformer,
      bottomPerformer,
      passRate,
      aboveAverageCount,
      belowAverageCount
    };
  } catch (error: any) {
    throw new Error(`Failed to calculate academic performance: ${error.message}`);
  }
}

// Calculate demographics
async function calculateDemographics(enrollments: any[]): Promise<any> {
  try {
    const students = enrollments.map(e => e.student);

    const maleCount = students.filter(s => s.gender === 'MALE').length;
    const femaleCount = students.filter(s => s.gender === 'FEMALE').length;

    // Calculate average age
    const ages = students.map(s => {
      const birthDate = new Date(s.date_of_birth);
      const today = new Date();
      return today.getFullYear() - birthDate.getFullYear();
    });
    const averageAge = ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0;

    const newStudents = students.filter(s => s.is_new_student).length;
    const repeaters = enrollments.filter(e => e.repeater).length;

    return {
      maleCount,
      femaleCount,
      averageAge,
      newStudents,
      repeaters
    };
  } catch (error: any) {
    throw new Error(`Failed to calculate demographics: ${error.message}`);
  }
}

// Calculate attendance metrics
async function calculateAttendanceMetrics(enrollments: any[]): Promise<any> {
  try {
    const totalStudents = enrollments.length;
    const allAbsences = enrollments.flatMap(e => e.absences || []);

    // Calculate average attendance rate
    const currentDate = new Date();
    const startOfYear = new Date(currentDate.getFullYear(), 0, 1);
    const daysInYear = Math.ceil((currentDate.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));

    const totalPossibleAttendance = totalStudents * daysInYear;
    const totalAbsences = allAbsences.length;
    const averageAttendanceRate = totalPossibleAttendance > 0
      ? ((totalPossibleAttendance - totalAbsences) / totalPossibleAttendance) * 100
      : 0;

    // Count chronic absentees (students with >20% absence rate)
    const studentAbsenceCounts = enrollments.map(enrollment => {
      const studentAbsences = enrollment.absences || [];
      const absenceRate = daysInYear > 0 ? (studentAbsences.length / daysInYear) * 100 : 0;
      return {
        student: enrollment.student,
        absenceRate,
        absenceCount: studentAbsences.length
      };
    });

    const chronicAbsentees = studentAbsenceCounts.filter(s => s.absenceRate > 20).length;
    const perfectAttendance = studentAbsenceCounts.filter(s => s.absenceCount === 0).length;

    return {
      averageAttendanceRate,
      chronicAbsentees,
      perfectAttendance
    };
  } catch (error: any) {
    throw new Error(`Failed to calculate attendance metrics: ${error.message}`);
  }
}

// Calculate financial metrics
async function calculateFinancialMetrics(enrollments: any[]): Promise<any> {
  try {
    const allFees = enrollments.flatMap(e => e.school_fees || []);

    const totalFeesExpected = allFees.reduce((sum, fee) => sum + fee.amount_expected, 0);
    const totalFeesCollected = allFees.reduce((sum, fee) => sum + fee.amount_paid, 0);
    const collectionRate = totalFeesExpected > 0 ? (totalFeesCollected / totalFeesExpected) * 100 : 0;
    // Clamped per fee row and summed separately, same rule as feeOutstandingService.ts:
    // one student's overpayment never offsets another's debt.
    const outstandingAmount = allFees.reduce((sum, fee) => sum + Math.max(fee.amount_expected - fee.amount_paid, 0), 0);
    const overpaymentAmount = allFees.reduce((sum, fee) => sum + Math.max(fee.amount_paid - fee.amount_expected, 0), 0);

    const defaulters = allFees.filter(fee => fee.amount_paid < fee.amount_expected).length;

    return {
      totalFeesExpected,
      totalFeesCollected,
      collectionRate,
      outstandingAmount,
      overpaymentAmount,
      defaulters
    };
  } catch (error: any) {
    throw new Error(`Failed to calculate financial metrics: ${error.message}`);
  }
}

// Calculate discipline metrics
async function calculateDisciplineMetrics(enrollments: any[]): Promise<any> {
  try {
    const allDisciplineIssues = enrollments.flatMap(e => e.discipline_issues || []);

    const totalIncidents = allDisciplineIssues.length;
    const resolvedIncidents = allDisciplineIssues.filter(issue =>
      issue.reviewed_by_id !== null
    ).length;
    const pendingIncidents = totalIncidents - resolvedIncidents;

    const studentsWithIssues = new Set(allDisciplineIssues.map(issue => issue.enrollment_id)).size;

    return {
      totalIncidents,
      resolvedIncidents,
      pendingIncidents,
      studentsWithIssues
    };
  } catch (error: any) {
    throw new Error(`Failed to calculate discipline metrics: ${error.message}`);
  }
}

// Calculate teacher metrics
async function calculateTeacherMetrics(classId: number, academicYearId: number): Promise<any> {
  try {
    const teacherPeriods = await prisma.teacherPeriod.findMany({
      where: {
        academic_year_id: academicYearId,
        sub_class: {
          class_id: classId
        }
      },
      include: {
        teacher: true,
        subject: true
      }
    });

    // teacher_id can be null (a period slot assigned to a subject before a teacher
    // is picked), which Prisma's `in` filter rejects outright -- filter those out.
    const uniqueTeachers = new Set(teacherPeriods.map(tp => tp.teacher_id).filter((id): id is number => id != null));
    const totalTeachers = uniqueTeachers.size;
    const uniqueSubjects = new Set(teacherPeriods.map(tp => tp.subject_id));
    const subjectsOffered = uniqueSubjects.size;

    // Calculate teacher attendance rate
    const teacherIds = Array.from(uniqueTeachers);
    const teacherAbsences = teacherIds.length > 0
      ? await prisma.teacherAbsence.count({
          where: {
            teacher_id: { in: teacherIds }
          }
        })
      : 0;

    const totalExpectedPresence = teacherIds.length * 365; // Approximate
    const teacherAttendanceRate = totalExpectedPresence > 0
      ? ((totalExpectedPresence - teacherAbsences) / totalExpectedPresence) * 100
      : 0;

    // For now, set average teacher rating to 0 (would need a rating system)
    const averageTeacherRating = 0;

    return {
      totalTeachers,
      averageTeacherRating,
      subjectsOffered,
      teacherAttendanceRate
    };
  } catch (error: any) {
    throw new Error(`Failed to calculate teacher metrics: ${error.message}`);
  }
}

// Compare two classes
export async function compareClasses(
  class1Id: number,
  class2Id: number,
  academicYearId?: number
): Promise<ClassComparison> {
  try {
    const [class1, class2] = await Promise.all([
      getClassProfileAnalytics(class1Id, academicYearId),
      getClassProfileAnalytics(class2Id, academicYearId)
    ]);

    const comparisons = {
      academicPerformance: {
        averageGradeDifference: class1.academicPerformance.averageGrade - class2.academicPerformance.averageGrade,
        passRateDifference: class1.academicPerformance.passRate - class2.academicPerformance.passRate,
        better: class1.academicPerformance.averageGrade > class2.academicPerformance.averageGrade ? 'class1' : 'class2'
      },
      attendance: {
        attendanceRateDifference: class1.attendance.averageAttendanceRate - class2.attendance.averageAttendanceRate,
        better: class1.attendance.averageAttendanceRate > class2.attendance.averageAttendanceRate ? 'class1' : 'class2'
      },
      finances: {
        collectionRateDifference: class1.finances.collectionRate - class2.finances.collectionRate,
        better: class1.finances.collectionRate > class2.finances.collectionRate ? 'class1' : 'class2'
      },
      discipline: {
        incidentRateDifference: (class1.discipline.totalIncidents / class1.totalStudents) - (class2.discipline.totalIncidents / class2.totalStudents),
        better: (class1.discipline.totalIncidents / class1.totalStudents) < (class2.discipline.totalIncidents / class2.totalStudents) ? 'class1' : 'class2'
      }
    };

    return {
      class1,
      class2,
      comparisons
    };
  } catch (error: any) {
    throw new Error(`Failed to compare classes: ${error.message}`);
  }
}

// Get all classes overview
export async function getAllClassesOverview(
  academicYearId?: number
): Promise<ClassProfileOverview[]> {
  try {
    const currentAcademicYearId = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentAcademicYearId) {
      throw new Error('No academic year found');
    }

    const classes = await prisma.class.findMany({
      orderBy: { name: 'asc' }
    });

    const classesOverview = [];
    for (const classInfo of classes) {
      try {
        const overview = await getClassProfileAnalytics(classInfo.id, currentAcademicYearId);
        classesOverview.push(overview);
      } catch (error) {
        console.error(`Error getting analytics for class ${classInfo.name}:`, error);
        // Continue with other classes
      }
    }

    return classesOverview;
  } catch (error: any) {
    throw new Error(`Failed to get all classes overview: ${error.message}`);
  }
}

// Get class performance trends
export async function getClassTrends(
  classId: number,
  dateFrom: string,
  dateTo: string,
  academicYearId?: number
): Promise<ClassTrendAnalysis> {
  try {
    const currentAcademicYearId = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentAcademicYearId) {
      throw new Error('No academic year found');
    }

    const startDate = new Date(dateFrom);
    const endDate = new Date(dateTo);

    // Get academic trends (monthly averages)
    const academicTrends = await getAcademicTrends(classId, startDate, endDate, currentAcademicYearId);

    // Get attendance trends
    const attendanceTrends = await getAttendanceTrends(classId, startDate, endDate, currentAcademicYearId);

    // Get financial trends
    const financialTrends = await getFinancialTrends(classId, startDate, endDate, currentAcademicYearId);

    // Get discipline trends
    const disciplineTrends = await getDisciplineTrends(classId, startDate, endDate, currentAcademicYearId);

    // Make simple predictions (next month based on trend)
    const predictions = {
      nextMonthPerformance: academicTrends.length > 0 ? academicTrends[academicTrends.length - 1].average : 0,
      nextMonthAttendance: attendanceTrends.length > 0 ? attendanceTrends[attendanceTrends.length - 1].rate : 0,
      nextMonthCollection: financialTrends.length > 0 ? financialTrends[financialTrends.length - 1].rate : 0
    };

    return {
      classId,
      trends: {
        academicTrends,
        attendanceTrends,
        financialTrends,
        disciplineTrends
      },
      predictions
    };
  } catch (error: any) {
    throw new Error(`Failed to get class trends: ${error.message}`);
  }
}

// Helper functions for trend analysis
async function getAcademicTrends(classId: number, startDate: Date, endDate: Date, academicYearId: number): Promise<any[]> {
  // Simplified implementation - would need more complex logic for real trends
  return [
    { month: 'January', average: 65 },
    { month: 'February', average: 68 },
    { month: 'March', average: 70 }
  ];
}

async function getAttendanceTrends(classId: number, startDate: Date, endDate: Date, academicYearId: number): Promise<any[]> {
  return [
    { month: 'January', rate: 85 },
    { month: 'February', rate: 87 },
    { month: 'March', rate: 89 }
  ];
}

async function getFinancialTrends(classId: number, startDate: Date, endDate: Date, academicYearId: number): Promise<any[]> {
  return [
    { month: 'January', rate: 75 },
    { month: 'February', rate: 78 },
    { month: 'March', rate: 82 }
  ];
}

async function getDisciplineTrends(classId: number, startDate: Date, endDate: Date, academicYearId: number): Promise<any[]> {
  return [
    { month: 'January', incidents: 12 },
    { month: 'February', incidents: 8 },
    { month: 'March', incidents: 5 }
  ];
}

// Get class ranking
export async function getClassRankings(
  criteria: 'academic' | 'attendance' | 'financial' | 'discipline',
  academicYearId?: number
): Promise<any[]> {
  try {
    const classesOverview = await getAllClassesOverview(academicYearId);

    let sortedClasses;

    switch (criteria) {
      case 'academic':
        sortedClasses = classesOverview.sort((a, b) =>
          b.academicPerformance.averageGrade - a.academicPerformance.averageGrade
        );
        break;
      case 'attendance':
        sortedClasses = classesOverview.sort((a, b) =>
          b.attendance.averageAttendanceRate - a.attendance.averageAttendanceRate
        );
        break;
      case 'financial':
        sortedClasses = classesOverview.sort((a, b) =>
          b.finances.collectionRate - a.finances.collectionRate
        );
        break;
      case 'discipline':
        sortedClasses = classesOverview.sort((a, b) =>
          (a.discipline.totalIncidents / a.totalStudents) - (b.discipline.totalIncidents / b.totalStudents)
        );
        break;
      default:
        sortedClasses = classesOverview;
    }

    return sortedClasses.map((classData, index) => ({
      rank: index + 1,
      ...classData
    }));
  } catch (error: any) {
    throw new Error(`Failed to get class rankings: ${error.message}`);
  }
} 