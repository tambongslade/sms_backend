# School Management System - Complete API Documentation

## Table of Contents
1. [Authentication](#authentication)
2. [Attendance Management](#attendance-management)
3. [Audit Trail](#audit-trail)
4. [Communications](#communications)
5. [Enhanced Dashboard Analytics](#enhanced-dashboard-analytics)
6. [Class Profile Analytics](#class-profile-analytics)
7. [Teacher Attendance Analytics](#teacher-attendance-analytics)
8. [Student Averages](#student-averages)
9. [Mobile API](#mobile-api)
10. [File Management](#file-management)
11. [Notifications](#notifications)
12. [Period Management](#period-management)
13. [Parent Portal](#parent-portal)
14. [Quiz System](#quiz-system)
15. [Vice Principal (Student Management)](#vice-principal-student-management)
16. [Bursar (Financial Management)](#bursar-financial-management)
17. [Discipline Master/SDM](#discipline-mastersдm)
18. [Teacher Portal](#teacher-portal)
19. [HOD (Head of Department)](#hod-head-of-department)
20. [Timetable Management](#timetable-management)
21. [Academic Year Management](#academic-year-management)
22. [Student Management](#student-management)
23. [User Management](#user-management)
24. [Exam and Marks Management](#exam-and-marks-management)
25. [Class and Subject Management](#class-and-subject-management)
26. [Dashboard Endpoints](#dashboard-endpoints)
27. [Report Card Management](#report-card-management)
28. [Authorization Testing](#authorization-testing)

---

## Attendance Management

### Get Student Attendance
```http
GET /api/v1/attendance/students
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `DISCIPLINE_MASTER`, `TEACHER`, `PARENT`

**Query Parameters:**
```typescript
{
  studentId?: number;
  subClassId?: number;
  date?: string; // "YYYY-MM-DD"
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  page?: number;
  limit?: number;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    attendance: Array<{
      id: number;
      studentId: number;
      subClassId: number;
      date: string;
      status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
      remarks?: string;
      recordedBy: number;
      createdAt: string;
      updatedAt: string;
      student: {
        id: number;
        name: string;
        matricule: string;
      };
      subClass: {
        id: number;
        name: string;
        classId: number;
        class: {
          id: number;
          name: string;
        };
      };
    }>;
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      itemsPerPage: number;
    };
  };
}
```

### Record Student Attendance
```http
POST /api/v1/attendance/students
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `DISCIPLINE_MASTER`, `TEACHER`

**Request Body:**
```typescript
{
  studentId: number;
  subClassId: number;
  date: string; // "YYYY-MM-DD"
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
  remarks?: string;
}
```

**Response (Success - 201):**
```typescript
{
  success: true;
  data: {
    id: number;
    studentId: number;
    subClassId: number;
    date: string;
    status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
    remarks?: string;
    recordedBy: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Update Student Attendance
```http
PUT /api/v1/attendance/students/:id
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `DISCIPLINE_MASTER`, `TEACHER`

**Request Body:**
```typescript
{
  status?: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
  remarks?: string;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    id: number;
    studentId: number;
    subClassId: number;
    date: string;
    status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
    remarks?: string;
    recordedBy: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Get Student Attendance Summary
```http
GET /api/v1/attendance/students/summary
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `DISCIPLINE_MASTER`, `TEACHER`, `PARENT`

**Query Parameters:**
```typescript
{
  studentId?: number;
  subClassId?: number;
  classId?: number;
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    summary: {
      totalDays: number;
      presentDays: number;
      absentDays: number;
      lateDays: number;
      excusedDays: number;
      attendanceRate: number; // percentage
    };
    details?: Array<{
      studentId: number;
      studentName: string;
      matricule: string;
      totalDays: number;
      presentDays: number;
      absentDays: number;
      lateDays: number;
      excusedDays: number;
      attendanceRate: number;
    }>;
  };
}
```

### Get Teacher Attendance
```http
GET /api/v1/attendance/teachers
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`

**Query Parameters:**
```typescript
{
  teacherId?: number;
  date?: string; // "YYYY-MM-DD"
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  page?: number;
  limit?: number;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    attendance: Array<{
      id: number;
      teacherId: number;
      date: string;
      status: "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
      checkInTime?: string;
      checkOutTime?: string;
      remarks?: string;
      recordedBy: number;
      createdAt: string;
      updatedAt: string;
      teacher: {
        id: number;
        name: string;
        email: string;
        matricule: string;
      };
    }>;
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      itemsPerPage: number;
    };
  };
}
```

### Record Teacher Attendance
```http
POST /api/v1/attendance/teachers
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`

**Request Body:**
```typescript
{
  teacherId: number;
  date: string; // "YYYY-MM-DD"
  status: "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
  checkInTime?: string; // "HH:MM"
  checkOutTime?: string; // "HH:MM"
  remarks?: string;
}
```

**Response (Success - 201):**
```typescript
{
  success: true;
  data: {
    id: number;
    teacherId: number;
    date: string;
    status: "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
    checkInTime?: string;
    checkOutTime?: string;
    remarks?: string;
    recordedBy: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Get Teacher Attendance Summary
```http
GET /api/v1/attendance/teachers/summary
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`

**Query Parameters:**
```typescript
{
  teacherId?: number;
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    summary: {
      totalDays: number;
      presentDays: number;
      absentDays: number;
      lateDays: number;
      onLeaveDays: number;
      attendanceRate: number; // percentage
    };
    details?: Array<{
      teacherId: number;
      teacherName: string;
      email: string;
      matricule: string;
      totalDays: number;
      presentDays: number;
      absentDays: number;
      lateDays: number;
      onLeaveDays: number;
      attendanceRate: number;
    }>;
  };
}
```

---

## Audit Trail

### Get Audit Logs
```http
GET /api/v1/audit/logs
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Query Parameters:**
```typescript
{
  page?: number;
  limit?: number;
  entityType?: string;
  entityId?: number;
  userId?: number;
  action?: string;
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    logs: Array<{
      id: number;
      entityType: string;
      entityId: number;
      action: string;
      oldValues?: Record<string, any>;
      newValues?: Record<string, any>;
      userId: number;
      userAgent?: string;
      ipAddress?: string;
      createdAt: string;
      user: {
        id: number;
        name: string;
        email: string;
        matricule: string;
      };
    }>;
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      itemsPerPage: number;
    };
  };
}
```

### Get Audit Statistics
```http
GET /api/v1/audit/stats
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Query Parameters:**
```typescript
{
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  entityType?: string;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    totalLogs: number;
    logsByAction: Record<string, number>;
    logsByEntityType: Record<string, number>;
    logsByUser: Array<{
      userId: number;
      userName: string;
      count: number;
    }>;
    logsByDate: Array<{
      date: string;
      count: number;
    }>;
    topActions: Array<{
      action: string;
      count: number;
    }>;
  };
}
```

### Get Entity Audit Trail
```http
GET /api/v1/audit/entity/:entityType/:entityId
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `entityType` (string): Type of entity (e.g., "User", "Student", "Class")
- `entityId` (number): ID of the entity

**Query Parameters:**
```typescript
{
  page?: number;
  limit?: number;
  action?: string;
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    entityType: string;
    entityId: number;
    logs: Array<{
      id: number;
      action: string;
      oldValues?: Record<string, any>;
      newValues?: Record<string, any>;
      userId: number;
      userAgent?: string;
      ipAddress?: string;
      createdAt: string;
      user: {
        id: number;
        name: string;
        email: string;
        matricule: string;
      };
    }>;
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      itemsPerPage: number;
    };
  };
}
```

### Get User Activity Summary
```http
GET /api/v1/audit/user/:userId/activity
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `userId` (number): ID of the user

**Query Parameters:**
```typescript
{
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  page?: number;
  limit?: number;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    userId: number;
    userName: string;
    totalActions: number;
    actionSummary: Record<string, number>;
    entitySummary: Record<string, number>;
    recentActivity: Array<{
      id: number;
      entityType: string;
      entityId: number;
      action: string;
      createdAt: string;
    }>;
    activityByDate: Array<{
      date: string;
      count: number;
    }>;
  };
}
```

### Get My Activity Summary
```http
GET /api/v1/audit/my-activity
```

**Authorization:** All authenticated users

**Query Parameters:**
```typescript
{
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  page?: number;
  limit?: number;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    totalActions: number;
    actionSummary: Record<string, number>;
    entitySummary: Record<string, number>;
    recentActivity: Array<{
      id: number;
      entityType: string;
      entityId: number;
      action: string;
      createdAt: string;
    }>;
    activityByDate: Array<{
      date: string;
      count: number;
    }>;
  };
}
```

### Create Audit Log
```http
POST /api/v1/audit/log
```

**Authorization:** `SUPER_MANAGER`

**Request Body:**
```typescript
{
  entityType: string;
  entityId: number;
  action: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  description?: string;
}
```

**Response (Success - 201):**
```typescript
{
  success: true;
  data: {
    id: number;
    entityType: string;
    entityId: number;
    action: string;
    oldValues?: Record<string, any>;
    newValues?: Record<string, any>;
    userId: number;
    userAgent?: string;
    ipAddress?: string;
    createdAt: string;
  };
}
```

---

## Communications

### Get Announcements
```http
GET /api/v1/communications/announcements
```

**Authorization:** All authenticated users

**Query Parameters:**
```typescript
{
  page?: number;
  limit?: number;
  audience?: "ALL" | "STUDENTS" | "PARENTS" | "TEACHERS" | "STAFF";
  academicYearId?: number;
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  active?: boolean;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    announcements: Array<{
      id: number;
      title: string;
      content: string;
      audience: "ALL" | "STUDENTS" | "PARENTS" | "TEACHERS" | "STAFF";
      priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
      isActive: boolean;
      publishDate: string;
      expiryDate?: string;
      academicYearId?: number;
      authorId: number;
      createdAt: string;
      updatedAt: string;
      author: {
        id: number;
        name: string;
        email: string;
      };
      academicYear?: {
        id: number;
        name: string;
        startDate: string;
        endDate: string;
      };
    }>;
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      itemsPerPage: number;
    };
  };
}
```

### Create Announcement
```http
POST /api/v1/communications/announcements
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`

**Request Body:**
```typescript
{
  title: string;
  content: string;
  audience: "ALL" | "STUDENTS" | "PARENTS" | "TEACHERS" | "STAFF";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; // Default: "MEDIUM"
  publishDate?: string; // "YYYY-MM-DD", Default: current date
  expiryDate?: string; // "YYYY-MM-DD"
  academicYearId?: number; // If not provided, uses current academic year
  isActive?: boolean; // Default: true
}
```

**Response (Success - 201):**
```typescript
{
  success: true;
  data: {
    id: number;
    title: string;
    content: string;
    audience: "ALL" | "STUDENTS" | "PARENTS" | "TEACHERS" | "STAFF";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    isActive: boolean;
    publishDate: string;
    expiryDate?: string;
    academicYearId?: number;
    authorId: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Update Announcement
```http
PUT /api/v1/communications/announcements/:id
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`

**Path Parameters:**
- `id` (number): Announcement ID

**Request Body:**
```typescript
{
  title?: string;
  content?: string;
  audience?: "ALL" | "STUDENTS" | "PARENTS" | "TEACHERS" | "STAFF";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  publishDate?: string; // "YYYY-MM-DD"
  expiryDate?: string; // "YYYY-MM-DD"
  isActive?: boolean;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    id: number;
    title: string;
    content: string;
    audience: "ALL" | "STUDENTS" | "PARENTS" | "TEACHERS" | "STAFF";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    isActive: boolean;
    publishDate: string;
    expiryDate?: string;
    academicYearId?: number;
    authorId: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Delete Announcement
```http
DELETE /api/v1/communications/announcements/:id
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`

**Path Parameters:**
- `id` (number): Announcement ID

**Response (Success - 200):**
```typescript
{
  success: true;
  message: "Announcement deleted successfully";
}
```

**Error Response (404):**
```typescript
{
  success: false;
  error: "Announcement not found";
}
```

### Send Notification
```http
POST /api/v1/communications/notifications
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`

**Request Body:**
```typescript
{
  title: string;
  message: string;
  audience: "ALL" | "STUDENTS" | "PARENTS" | "TEACHERS" | "STAFF";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; // Default: "MEDIUM"
  sendImmediate?: boolean; // Default: true
  scheduledTime?: string; // ISO string, required if sendImmediate is false
  academicYearId?: number; // If not provided, uses current academic year
  targetUserIds?: number[]; // Specific users to notify (overrides audience)
  actionUrl?: string; // Deep link for mobile apps
  category?: string; // Notification category for filtering
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    notificationId: string;
    title: string;
    message: string;
    audience: "ALL" | "STUDENTS" | "PARENTS" | "TEACHERS" | "STAFF";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    recipientCount: number;
    sentAt: string;
    status: "SENT" | "SCHEDULED" | "FAILED";
    failureReason?: string;
  };
}
```

**Error Response (400):**
```typescript
{
  success: false;
  error: "Invalid notification data" | "Scheduled time must be in the future" | "No recipients found for the specified audience";
}
```

---

## Enhanced Dashboard Analytics

### Super Manager Enhanced Dashboard
```http
GET /api/v1/dashboard/super-manager/enhanced
```

**Authorization:** `SUPER_MANAGER`

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    systemOverview: {
      totalUsers: number;
      totalStudents: number;
      totalTeachers: number;
      totalClasses: number;
      activeAcademicYears: number;
    };
    academicProgress: {
      enrollmentStats: {
        totalEnrolled: number;
        pendingInterviews: number;
        unassignedStudents: number;
      };
      performanceMetrics: {
        averageAttendanceRate: number;
        overallGrades: Record<string, number>;
      };
    };
    financialSummary: {
      totalRevenue: number;
      outstandingFees: number;
      collectionRate: number;
      monthlyTrends: Array<{
        month: string;
        collected: number;
        outstanding: number;
      }>;
    };
    operationalInsights: {
      recentAuditActivities: Array<{
        id: number;
        action: string;
        entityType: string;
        userId: number;
        createdAt: string;
      }>;
      systemHealth: {
        uptime: string;
        performance: "GOOD" | "FAIR" | "POOR";
        lastBackup: string;
      };
    };
  };
}
```

### Manager Enhanced Dashboard
```http
GET /api/v1/dashboard/manager/enhanced
```

**Authorization:** `MANAGER`, `SUPER_MANAGER`

**Response:** Same as Super Manager Enhanced Dashboard

### Bursar Enhanced Dashboard
```http
GET /api/v1/dashboard/bursar/enhanced
```

**Authorization:** `BURSAR`, `SUPER_MANAGER`, `MANAGER`

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    financialOverview: {
      totalRevenue: number;
      monthlyRevenue: number;
      outstandingAmount: number;
      collectionRate: number;
      defaultersCount: number;
    };
    enrollmentFinancials: {
      totalEnrollments: number;
      paidEnrollments: number;
      pendingPayments: number;
      averageFeePerStudent: number;
    };
    paymentTrends: Array<{
      month: string;
      collected: number;
      target: number;
      variance: number;
    }>;
    recentTransactions: Array<{
      id: number;
      studentName: string;
      amount: number;
      type: string;
      date: string;
      status: string;
    }>;
    alerts: {
      overduePayments: number;
      newDefaulters: number;
      largePayments: number;
    };
  };
}
```

### Vice Principal Enhanced Dashboard
```http
GET /api/v1/dashboard/vp/enhanced
```

**Authorization:** `VICE_PRINCIPAL`, `SUPER_MANAGER`, `MANAGER`

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    studentManagement: {
      totalStudents: number;
      pendingInterviews: number;
      unassignedStudents: number;
      recentEnrollments: number;
    };
    interviewScheduling: {
      scheduledToday: number;
      scheduledThisWeek: number;
      completedThisMonth: number;
      pendingRescheduling: number;
    };
    classCapacityAnalysis: Array<{
      classId: number;
      className: string;
      capacity: number;
      currentStudents: number;
      utilizationRate: number;
      recommendedAction: string;
    }>;
    disciplinaryOverview: {
      activeIssues: number;
      resolvedThisWeek: number;
      studentsOnWatch: number;
    };
    upcomingTasks: Array<{
      id: number;
      task: string;
      dueDate: string;
      priority: "HIGH" | "MEDIUM" | "LOW";
    }>;
  };
}
```

### Teacher Analytics
```http
GET /api/v1/dashboard/teacher-analytics
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  departmentId?: number;
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    overview: {
      totalTeachers: number;
      activeTeachers: number;
      teachersOnLeave: number;
      averageAttendanceRate: number;
    };
    performanceMetrics: Array<{
      teacherId: number;
      teacherName: string;
      subjectsCount: number;
      studentsCount: number;
      attendanceRate: number;
      averageStudentPerformance: number;
      lastLogin: string;
    }>;
    departmentBreakdown: Array<{
      department: string;
      teacherCount: number;
      avgPerformance: number;
      attendanceRate: number;
    }>;
    workloadAnalysis: Array<{
      teacherId: number;
      teacherName: string;
      totalClasses: number;
      totalStudents: number;
      workloadScore: number;
      recommendation: string;
    }>;
  };
}
```

### Class Profiles
```http
GET /api/v1/dashboard/class-profiles
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  classId?: number;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    classOverview: Array<{
      classId: number;
      className: string;
      totalSubClasses: number;
      totalStudents: number;
      averageAttendance: number;
      averagePerformance: number;
      teacherCount: number;
    }>;
    performanceRankings: Array<{
      rank: number;
      classId: number;
      className: string;
      averageGrade: number;
      attendanceRate: number;
      completionRate: number;
    }>;
    capacityUtilization: Array<{
      classId: number;
      className: string;
      maxCapacity: number;
      currentStudents: number;
      utilizationRate: number;
      status: "UNDER_UTILIZED" | "OPTIMAL" | "OVER_CAPACITY";
    }>;
  };
}
```

### Reports Analytics
```http
GET /api/v1/dashboard/reports-analytics
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    reportGeneration: {
      totalReportsGenerated: number;
      reportsThisMonth: number;
      avgGenerationTime: number;
      successRate: number;
    };
    upcomingDeadlines: Array<{
      reportType: string;
      dueDate: string;
      priority: "HIGH" | "MEDIUM" | "LOW";
      assignedTo: string;
      status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
    }>;
    reportTypes: Array<{
      type: string;
      count: number;
      lastGenerated: string;
      avgSize: string;
    }>;
    performance: {
      fastestGeneration: number;
      slowestGeneration: number;
      failureRate: number;
      popularReports: Array<{
        type: string;
        count: number;
      }>;
    };
  };
}
```

### Audit Trail Dashboard
```http
GET /api/v1/dashboard/audit-trail
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`

**Query Parameters:**
```typescript
{
  timeframe?: "24h" | "7d" | "30d";
  entityType?: string;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    activitySummary: {
      totalActions: number;
      uniqueUsers: number;
      criticalActions: number;
      failedActions: number;
    };
    recentActivities: Array<{
      id: number;
      action: string;
      entityType: string;
      entityId: number;
      userId: number;
      userName: string;
      timestamp: string;
      risk: "LOW" | "MEDIUM" | "HIGH";
    }>;
    userActivity: Array<{
      userId: number;
      userName: string;
      actionCount: number;
      lastActivity: string;
      riskScore: number;
    }>;
    systemChanges: Array<{
      category: string;
      changeCount: number;
      lastChange: string;
    }>;
  };
}
```

### Financial Overview
```http
GET /api/v1/dashboard/financial-overview
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `BURSAR`

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  timeframe?: "month" | "quarter" | "year";
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    summary: {
      totalRevenue: number;
      outstandingAmount: number;
      collectionRate: number;
      totalStudents: number;
      paidStudents: number;
    };
    monthlyTrends: Array<{
      month: string;
      revenue: number;
      target: number;
      collections: number;
      outstanding: number;
    }>;
    feeCategories: Array<{
      category: string;
      totalAmount: number;
      collectedAmount: number;
      outstandingAmount: number;
      collectionRate: number;
    }>;
    defaultersAnalysis: {
      totalDefaulters: number;
      amountInDefault: number;
      topDefaulters: Array<{
        studentId: number;
        studentName: string;
        outstandingAmount: number;
        daysPastDue: number;
      }>;
    };
  };
}
```

### Student Registration Analytics
```http
GET /api/v1/dashboard/student-registration
```

**Authorization:** `BURSAR`, `SUPER_MANAGER`, `MANAGER`

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  timeframe?: "week" | "month" | "quarter";
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    registrationStats: {
      totalRegistrations: number;
      completedRegistrations: number;
      pendingPayments: number;
      rejectedApplications: number;
    };
    dailyRegistrations: Array<{
      date: string;
      newRegistrations: number;
      completedPayments: number;
      pendingCount: number;
    }>;
    classDistribution: Array<{
      classId: number;
      className: string;
      registeredStudents: number;
      capacity: number;
      waitingList: number;
    }>;
    paymentAnalysis: {
      totalFeesCollected: number;
      averagePaymentTime: number;
      paymentMethods: Record<string, number>;
      installmentPlans: number;
    };
  };
}
```

### Interview Management Analytics
```http
GET /api/v1/dashboard/interview-management
```

**Authorization:** `VICE_PRINCIPAL`, `SUPER_MANAGER`, `MANAGER`

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  status?: "SCHEDULED" | "COMPLETED" | "PENDING";
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    interviewStats: {
      totalScheduled: number;
      completedToday: number;
      pendingThisWeek: number;
      averageInterviewDuration: number;
    };
    scheduleOverview: Array<{
      date: string;
      scheduledCount: number;
      completedCount: number;
      rescheduledCount: number;
      noShowCount: number;
    }>;
    interviewOutcomes: {
      accepted: number;
      rejected: number;
      pending: number;
      waitlisted: number;
    };
    interviewerWorkload: Array<{
      interviewerId: number;
      interviewerName: string;
      scheduledInterviews: number;
      completedInterviews: number;
      averageRating: number;
    }>;
  };
}
```

---

## Class Profile Analytics

### Get Classes Overview
```http
GET /api/v1/class-analytics/overview
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  limit?: number;
  orderBy?: "performance" | "attendance" | "capacity";
  orderDirection?: "asc" | "desc";
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    totalClasses: number;
    averageClassSize: number;
    totalCapacity: number;
    utilizationRate: number;
    classes: Array<{
      classId: number;
      className: string;
      totalSubClasses: number;
      totalStudents: number;
      capacity: number;
      utilizationRate: number;
      averageAttendanceRate: number;
      averagePerformance: number;
      teacherCount: number;
      status: "EXCELLENT" | "GOOD" | "AVERAGE" | "NEEDS_IMPROVEMENT";
    }>;
  };
}
```

### Get Class Rankings
```http
GET /api/v1/class-analytics/rankings
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  metric?: "performance" | "attendance" | "improvement";
  limit?: number;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    performanceRankings: Array<{
      rank: number;
      classId: number;
      className: string;
      averageGrade: number;
      improvementRate: number;
      totalStudents: number;
    }>;
    attendanceRankings: Array<{
      rank: number;
      classId: number;
      className: string;
      attendanceRate: number;
      consistencyScore: number;
      totalStudents: number;
    }>;
    overallRankings: Array<{
      rank: number;
      classId: number;
      className: string;
      overallScore: number;
      strengthAreas: string[];
      improvementAreas: string[];
    }>;
  };
}
```

### Get Class Profile Analytics
```http
GET /api/v1/class-analytics/class/:classId
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `classId` (number): Class ID

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  includeStudentDetails?: boolean;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    classInfo: {
      classId: number;
      className: string;
      capacity: number;
      currentStudents: number;
      totalSubClasses: number;
      classLevel: string;
    };
    academicPerformance: {
      overallAverage: number;
      subjectPerformance: Array<{
        subjectId: number;
        subjectName: string;
        averageGrade: number;
        passRate: number;
        topPerformers: number;
        strugglingStudents: number;
      }>;
      gradeDistribution: Record<string, number>;
      termComparison: Array<{
        term: string;
        average: number;
        improvement: number;
      }>;
    };
    attendanceAnalysis: {
      overallAttendanceRate: number;
      attendanceTrends: Array<{
        month: string;
        rate: number;
        daysTracked: number;
      }>;
      attendanceBySubject: Array<{
        subjectId: number;
        subjectName: string;
        attendanceRate: number;
      }>;
    };
    teachingStaff: Array<{
      teacherId: number;
      teacherName: string;
      subjectsTeaching: string[];
      performanceRating: number;
      studentFeedbackScore: number;
    }>;
    studentDetails?: Array<{
      studentId: number;
      studentName: string;
      matricule: string;
      overallGrade: number;
      attendanceRate: number;
      rank: number;
      status: "EXCELLENT" | "GOOD" | "AVERAGE" | "AT_RISK";
    }>;
  };
}
```

### Get Class Dashboard Summary
```http
GET /api/v1/class-analytics/class/:classId/summary
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `classId` (number): Class ID

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    quickStats: {
      totalStudents: number;
      averageGrade: number;
      attendanceRate: number;
      capacityUtilization: number;
    };
    alerts: Array<{
      type: "LOW_ATTENDANCE" | "POOR_PERFORMANCE" | "CAPACITY_ISSUE" | "TEACHER_SHORTAGE";
      severity: "HIGH" | "MEDIUM" | "LOW";
      message: string;
      affectedCount: number;
    }>;
    recentActivity: Array<{
      date: string;
      activity: string;
      type: "ACADEMIC" | "ATTENDANCE" | "DISCIPLINARY";
      impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
    }>;
    upcomingEvents: Array<{
      date: string;
      event: string;
      type: "EXAM" | "ASSESSMENT" | "MEETING" | "ACTIVITY";
      priority: "HIGH" | "MEDIUM" | "LOW";
    }>;
  };
}
```

### Get Class Insights
```http
GET /api/v1/class-analytics/class/:classId/insights
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `classId` (number): Class ID

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    strengthAreas: Array<{
      area: string;
      score: number;
      description: string;
      evidence: string[];
    }>;
    improvementAreas: Array<{
      area: string;
      score: number;
      description: string;
      recommendations: string[];
      priority: "HIGH" | "MEDIUM" | "LOW";
    }>;
    riskFactors: Array<{
      factor: string;
      riskLevel: "HIGH" | "MEDIUM" | "LOW";
      affectedStudents: number;
      description: string;
      interventions: string[];
    }>;
    predictions: {
      endOfTermAverage: number;
      expectedPassRate: number;
      atRiskStudents: number;
      confidence: number;
    };
  };
}
```

### Get Class Trends
```http
GET /api/v1/class-analytics/class/:classId/trends
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `classId` (number): Class ID

**Query Parameters:**
```typescript
{
  timeframe?: "term" | "year" | "all";
  metrics?: string[]; // ["performance", "attendance", "behavior"]
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    performanceTrends: Array<{
      period: string;
      averageGrade: number;
      improvement: number;
      topPerformers: number;
      strugglingStudents: number;
    }>;
    attendanceTrends: Array<{
      period: string;
      attendanceRate: number;
      change: number;
      consistentAttendees: number;
      frequentAbsentees: number;
    }>;
    behaviorTrends: Array<{
      period: string;
      disciplinaryIssues: number;
      positiveReports: number;
      overallBehaviorScore: number;
    }>;
    capacityTrends: Array<{
      period: string;
      enrollment: number;
      capacity: number;
      utilizationRate: number;
      waitingList: number;
    }>;
  };
}
```

### Compare Classes
```http
GET /api/v1/class-analytics/compare/:class1Id/:class2Id
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `class1Id` (number): First class ID
- `class2Id` (number): Second class ID

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  metrics?: string[]; // ["performance", "attendance", "capacity", "behavior"]
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    class1: {
      classId: number;
      className: string;
      totalStudents: number;
      averageGrade: number;
      attendanceRate: number;
      capacityUtilization: number;
    };
    class2: {
      classId: number;
      className: string;
      totalStudents: number;
      averageGrade: number;
      attendanceRate: number;
      capacityUtilization: number;
    };
    comparison: {
      performanceDifference: number;
      attendanceDifference: number;
      capacityDifference: number;
      overallRanking: {
        class1Rank: number;
        class2Rank: number;
      };
    };
    detailedComparison: {
      subjectPerformance: Array<{
        subjectName: string;
        class1Average: number;
        class2Average: number;
        difference: number;
      }>;
      strengthsWeaknesses: {
        class1Strengths: string[];
        class1Weaknesses: string[];
        class2Strengths: string[];
        class2Weaknesses: string[];
      };
    };
  };
}
```

### Export Class Analytics Report
```http
GET /api/v1/class-analytics/class/:classId/export
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `classId` (number): Class ID

**Query Parameters:**
```typescript
{
  format?: "pdf" | "excel" | "csv";
  includeStudentDetails?: boolean;
  academicYearId?: number;
  sections?: string[]; // ["performance", "attendance", "insights", "trends"]
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    reportId: string;
    downloadUrl: string;
    filename: string;
    format: "pdf" | "excel" | "csv";
    generatedAt: string;
    expiresAt: string;
    fileSize: string;
  };
}
```

**Error Response (400):**
```typescript
{
  success: false;
  error: "Invalid class ID" | "Class not found" | "Export format not supported";
}
```

---

## Teacher Attendance Analytics

### Get Teacher Attendance Overview
```http
GET /api/v1/teacher-attendance/overview
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    totalTeachers: number;
    presentToday: number;
    absentToday: number;
    onLeaveToday: number;
    overallAttendanceRate: number;
    departmentBreakdown: Array<{
      department: string;
      totalTeachers: number;
      presentCount: number;
      attendanceRate: number;
    }>;
  };
}
```

### Get Teacher Attendance Details
```http
GET /api/v1/teacher-attendance/details
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Query Parameters:**
```typescript
{
  teacherId?: number;
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  status?: "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
  page?: number;
  limit?: number;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    attendance: Array<{
      teacherId: number;
      teacherName: string;
      date: string;
      status: "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
      checkInTime?: string;
      checkOutTime?: string;
      hoursWorked?: number;
      department: string;
    }>;
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
    };
  };
}
```

### Record Teacher Attendance
```http
POST /api/v1/teacher-attendance/record
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `DISCIPLINE_MASTER`

**Request Body:**
```typescript
{
  teacherId: number;
  date: string; // "YYYY-MM-DD"
  status: "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
  checkInTime?: string; // "HH:MM"
  checkOutTime?: string; // "HH:MM"
  remarks?: string;
}
```

**Response (Success - 201):**
```typescript
{
  success: true;
  data: {
    id: number;
    teacherId: number;
    date: string;
    status: "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
    checkInTime?: string;
    checkOutTime?: string;
    hoursWorked?: number;
    recordedBy: number;
    createdAt: string;
  };
}
```

---

## Student Averages

### Calculate Student Averages
```http
POST /api/v1/student-averages/calculate/:examSequenceId
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `TEACHER`

**Path Parameters:**
- `examSequenceId` (number): Exam sequence ID

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    calculatedCount: number;
    examSequenceId: number;
    academicYearId: number;
    calculatedAt: string;
  };
}
```

### Get Sequence Averages
```http
GET /api/v1/student-averages/sequence/:examSequenceId
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `TEACHER`, `PARENT`

**Path Parameters:**
- `examSequenceId` (number): Exam sequence ID

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    averages: Array<{
      id: number;
      enrollmentId: number;
      examSequenceId: number;
      totalMarks: number;
      averageScore: number;
      rank: number;
      decision: "PROMOTED" | "REPEATED" | "PENDING";
      student: {
        id: number;
        name: string;
        matricule: string;
      };
      subClass: {
        id: number;
        name: string;
      };
    }>;
  };
}
```

---

## Mobile API

### Get Mobile Dashboard
```http
GET /api/v1/mobile/dashboard
```

**Authorization:** All authenticated users

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    user: {
      id: number;
      name: string;
      role: string;
      photo?: string;
    };
    quickStats: Record<string, any>; // Role-specific stats
    recentActivity: Array<{
      type: string;
      message: string;
      timestamp: string;
    }>;
    notifications: {
      unreadCount: number;
      recent: Array<{
        id: number;
        title: string;
        message: string;
        createdAt: string;
      }>;
    };
  };
}
```

### Register Mobile Device
```http
POST /api/v1/mobile/register-device
```

**Authorization:** All authenticated users

**Request Body:**
```typescript
{
  deviceToken: string;
  platform: "ios" | "android";
  appVersion: string;
  deviceInfo?: {
    model: string;
    osVersion: string;
  };
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    deviceId: string;
    registered: boolean;
    pushEnabled: boolean;
  };
}
```

---

## File Management

### Upload File
```http
POST /api/v1/uploads
```

**Authorization:** All authenticated users

**Request:** Form data with file
- `file` (File): The file to upload

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    filename: string;
    originalName: string;
    size: number;
    mimetype: string;
    url: string;
    uploadedAt: string;
  };
}
```

### Delete File
```http
DELETE /api/v1/uploads/:filename
```

**Authorization:** All authenticated users

**Path Parameters:**
- `filename` (string): Name of the file to delete

**Response (Success - 200):**
```typescript
{
  success: true;
  message: "File deleted successfully";
}
```

---

## Notifications

### Get Notification Templates
```http
GET /api/v1/notifications/templates
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `BURSAR`

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    templates: Array<{
      id: number;
      name: string;
      title: string;
      body: string;
      category: string;
      variables: string[];
    }>;
  };
}
```

### Get My Notifications
```http
GET /api/v1/notifications/me
```

**Authorization:** All authenticated users

**Query Parameters:**
```typescript
{
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    notifications: Array<{
      id: number;
      title: string;
      message: string;
      category: string;
      isRead: boolean;
      actionUrl?: string;
      createdAt: string;
    }>;
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
    };
  };
}
```

### Send Notification
```http
POST /api/v1/notifications/send
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `BURSAR`, `DISCIPLINE_MASTER`

**Request Body:**
```typescript
{
  title: string;
  message: string;
  recipientIds: number[];
  category?: string;
  actionUrl?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    notificationId: string;
    recipientCount: number;
    sentAt: string;
  };
}
```

---

## Period Management

### Get All Periods
```http
GET /api/v1/periods
```

**Authorization:** All authenticated users

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    periods: Array<{
      id: number;
      name: string;
      startTime: string; // "HH:MM"
      endTime: string; // "HH:MM"
      dayOfWeek: number; // 1-7 (Monday=1)
      isActive: boolean;
      createdAt: string;
    }>;
  };
}
```

### Create Period
```http
POST /api/v1/periods
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `DEAN_OF_STUDIES`

**Request Body:**
```typescript
{
  name: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  dayOfWeek: number; // 1-7 (Monday=1)
  isActive?: boolean; // Default: true
}
```

**Response (Success - 201):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    startTime: string;
    endTime: string;
    dayOfWeek: number;
    isActive: boolean;
    createdAt: string;
  };
}
```

### Update Period
```http
PUT /api/v1/periods/:id
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `DEAN_OF_STUDIES`

**Path Parameters:**
- `id` (number): Period ID

**Request Body:**
```typescript
{
  name?: string;
  startTime?: string; // "HH:MM"
  endTime?: string; // "HH:MM"
  dayOfWeek?: number; // 1-7
  isActive?: boolean;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    startTime: string;
    endTime: string;
    dayOfWeek: number;
    isActive: boolean;
    updatedAt: string;
  };
}
```

### Delete Period
```http
DELETE /api/v1/periods/:id
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `DEAN_OF_STUDIES`

**Path Parameters:**
- `id` (number): Period ID

**Response (Success - 200):**
```typescript
{
  success: true;
  message: "Period deleted successfully";
}
```

---

## Authentication

### Login
```http
POST /api/v1/auth/login
```

**Request Body:**

Provide exactly one of `identifier`, `email`, `phone`, or `matricule` — plus the password.
`identifier` is a single-input convenience: contains `@` → treated as email, digits (with optional `+`) → phone, otherwise → matricule. Phone login is staff-only; parents must use matricule.

```typescript
{
  identifier?: string; // Email, phone, or matricule (auto-detected)
  email?: string;      // Staff or student email
  phone?: string;      // Staff phone number — "+237XXXXXXXXX" or "XXXXXXXXX"
  matricule?: string;  // Parent matricule
  password: string;    // Required
}
```

**Error cases specific to phone login:**
- `401` `"Multiple accounts share this phone number. Please sign in with your email."` — the phone matches more than one staff account.
- `401` `"Invalid phone number"` — fewer than 8 digits after normalization.

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    token: string;
    expiresIn: string; // "120d"
    mustChangePassword: boolean; // true → force user to change password before allowing any other action
    user: {
      id: number;
      name: string;
      email: string;
      matricule: string;
      gender: "MALE" | "FEMALE";
      dateOfBirth: string;
      phone: string;
      address: string;
      idCardNum?: string;
      photo?: string;
      status: string;
      mustChangePassword: boolean; // Mirrors the top-level flag
      createdAt: string;
      updatedAt: string;
      userRoles: Array<{
        id: number;
        userId: number;
        role: "SUPER_MANAGER" | "MANAGER" | "PRINCIPAL" | "VICE_PRINCIPAL" | "BURSAR" | "DISCIPLINE_MASTER" | "TEACHER" | "HOD" | "PARENT" | "STUDENT";
        academicYearId?: number;
        createdAt: string;
        updatedAt: string;
      }>;
    };
  };
}
```

**First-login flow (all parents on 2026-09-04 and all bursar-created parents):**
Accounts created with the shared default password `password123` are flagged
`mustChangePassword: true`. The token is still issued so the client can call
`POST /auth/change-password` immediately, but the frontend MUST gate every
other request behind a "Set your new password" screen until the flag clears.

**Error Response (401):**
```typescript
{
  success: false;
  error: "Invalid credentials";
}
```

### Change Password
```http
POST /api/v1/auth/change-password
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  currentPassword?: string; // Required for normal changes; OMIT on forced first-login change
  newPassword: string;      // Minimum 8 characters, must differ from current
}
```

**Behavior:**
- Normal path — `currentPassword` is required and must match.
- First-login path — when the authenticated user has `mustChangePassword: true`,
  `currentPassword` may be omitted. The flag is cleared on success.
- On success the current token is blacklisted; the client must sign in again.

**Response (Success - 200):**
```typescript
{
  success: true;
  message: "Password changed successfully. Please sign in again.";
}
```

**Error Responses:**
- `400` `"newPassword is required"`
- `400` `"newPassword must be at least 8 characters long"`
- `400` `"Current password is required"` (normal flow, missing field)
- `400` `"Current password is incorrect"`
- `400` `"New password must be different from the current password"`
- `401` `"Unauthorized"` (no/invalid token)

### Register User
```http
POST /api/v1/auth/register
```

**Request Body:**
```typescript
{
  name: string;
  email: string;
  password: string;
  gender: "MALE" | "FEMALE";
  dateOfBirth: string; // "YYYY-MM-DD"
  phone: string;
  address: string;
  idCardNum?: string;
  photo?: string;
  status?: string;
}
```

### Get Profile
```http
GET /api/v1/auth/me
Authorization: Bearer <token>
```

### Logout
```http
POST /api/v1/auth/logout
Authorization: Bearer <token>
```

---

## Parent Portal

> **No authentication.** The parent portal is a public interface: the parent
> types their child's matricule and the frontend calls these endpoints
> directly. No JWT / no login is involved. Knowledge of the matricule is
> treated as sufficient proof of access. All endpoints below are scoped to a
> single child via the `:matricule` path parameter (except `/announcements`,
> which is school-wide). If a parent has multiple children, the frontend
> lets them switch matricules — one child per matricule.
>
> Messaging endpoints derive the sender identity from the child's first
> `ParentStudent` link. If the student has no linked parent user, those
> endpoints return `404 { error: "No parent is linked to this student" }`.

### Child Dashboard (single-child summary)
```http
GET /api/v1/parents/:matricule/dashboard
```

**Path Parameters:**
- `matricule` (string): Child's matricule.

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Defaults to current academic year
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    matricule: string;
    className?: string;
    subclassName?: string;
    enrollmentStatus: string;
    photo?: string;
    attendanceRate: number;
    latestMarks: Array<{
      subjectName: string;
      latestMark: number;
      sequence: string;
      date: string;
    }>;
    pendingFees: number;      // outstanding balance (expected - paid)
    disciplineIssues: number;
    recentAbsences: number;
    fees: {
      totalExpected: number;
      totalPaid: number;
      outstanding: number;
    };
  };
}
```

### Get Child Details (full profile)
```http
GET /api/v1/parents/:matricule/details
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    matricule: string;
    dateOfBirth: string;
    classInfo?: {
      className: string;
      subclassName: string;
      classMaster?: string;
    };
    attendance: {
      presentDays: number;
      absentDays: number;
      lateDays: number;
      attendanceRate: number;
    };
    academicPerformance: {
      subjects: Array<{
        subjectName: string;
        teacherName: string;
        marks: Array<{ sequence: string; mark: number; total: number; date: string; }>;
        average: number;
      }>;
      overallAverage: number;
      positionInClass?: number;
    };
    fees: {
      totalExpected: number;
      totalPaid: number;
      outstandingBalance: number;
      lastPaymentDate?: string;
      paymentHistory: Array<{
        id: number;
        amount: number;
        paymentDate: string;
        paymentMethod: string;
        receiptNumber?: string;
        recordedBy: string;
      }>;
    };
    discipline: {
      totalIssues: number;
      recentIssues: Array<{
        id: number;
        type: string;
        description: string;
        dateOccurred: string;
        status: string;
        resolvedAt?: string;
      }>;
    };
    reports: {
      availableReports: Array<{
        id: number;
        sequenceName: string;
        academicYear: string;
        generatedAt: string;
        downloadUrl: string;
      }>;
    };
  };
}
```

### Get Child Overview (combined snapshot)
```http
GET /api/v1/parents/:matricule/overview
```

Combined profile + enrollment + academic (marks grouped by sequence)
+ discipline + health (chronic conditions & nurse-visit log).

**Query Parameters:**
```typescript
{ academicYearId?: number; }
```

### Get Child Quiz Results
```http
GET /api/v1/parents/:matricule/quiz-results
```

**Query Parameters:**
```typescript
{ academicYearId?: number; }
```

### Get Child Analytics
```http
GET /api/v1/parents/:matricule/analytics
```

**Query Parameters:**
```typescript
{ academicYearId?: number; }
```

**Response (200):** See legacy `analytics` shape (`studentInfo`,
`performanceAnalytics`, `attendanceAnalytics`, `quizAnalytics`,
`subjectTrends`, `comparativeAnalytics`).

### List Available Report Cards
```http
GET /api/v1/parents/:matricule/report-cards
```

**Query Parameters:**
```typescript
{ academicYearId?: number; }
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    student: { id: number; matricule: string; name: string; };
    reports: Array<{
      id: number;
      examSequenceId: number;
      sequenceNumber: number;
      termName: string;
      academicYearId: number;
      academicYearName: string;
      status: string;
      generatedAt: string;
      errorMessage?: string;
    }>;
  };
}
```

### Check Report Card Availability
```http
GET /api/v1/parents/:matricule/report-card/availability?academicYearId=..&examSequenceId=..
```

Both query params are required.

### Download Report Card PDF
```http
GET /api/v1/parents/:matricule/report-card?academicYearId=..&examSequenceId=..
```

Streams `application/pdf`. Fee-gate rules from the exam controller still
apply (a report card may be blocked if fees are outstanding).

### Get Contacts (staff directory)
```http
GET /api/v1/parents/:matricule/contacts
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    fixed_staff: Array<{ id, name, matricule, photo, user_roles }>;    // Principal, VP, Bursar, DoS
    child_teachers: Array<{ id, name, matricule, photo, user_roles, teaches: [{ student, subject, sub_class }] }>;
    hods_by_subject: Array<{ subject: { id, name }, hod: { id, name, matricule, photo, user_roles } }>;
  };
}
```

### Send Message to Staff
```http
POST /api/v1/parents/:matricule/message-staff
```

**Request Body:**
```typescript
{
  recipientId: number;                          // staff user id
  subject: string;
  message: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";         // optional
}
```

**Response (201):**
```typescript
{ success: true; data: { message: "Message sent successfully"; notification: {...} } }
```

### Open Direct Message Channel
```http
POST /api/v1/parents/:matricule/contact/:userId
```

Opens (or reuses) a DM chat channel between the child's linked parent and
the given staff user. Frontend then posts messages via
`POST /chat/channels/:channelId/messages` (see Chat module).

**Response (200):**
```typescript
{ success: true; data: { id: number; ... /* channel */ } }
```

### Get School Announcements
```http
GET /api/v1/parents/announcements?limit=10
```

`limit` must be between 1 and 50 (defaults to 10). No matricule required.

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    title: string;
    content: string;
    author: string;
    created_at: string;
  }>;
}
```

---

### Multi-Child Family View (Authenticated Parent)
```http
GET /api/v1/parents/me/children
Authorization: Bearer <parent JWT>
```

Requires the caller to be authenticated with the `PARENT` role. Returns every
child linked to that parent plus a rollup summary for the whole family (total
fees owed across children, any-child-at-risk flag, active discipline count).

**Query Parameters:**
```typescript
{ academicYearId?: number; }
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    parentId: number;
    academicYearId: number | null;
    familySummary: {
      totalChildren: number;
      fees: { totalExpected: number; totalPaid: number; outstanding: number; };
      attendance: { totalUnexcusedAbsences: number; anyChildAtRisk: boolean; };
      discipline: { totalActiveIssues: number; };
    };
    children: Array<{
      studentId: number;
      matricule: string;
      name: string;
      gender: string;
      dateOfBirth: string;
      relationship: 'FATHER' | 'MOTHER' | 'GUARDIAN' | 'SIBLING' | null;
      enrollment: { academicYearId: number; className: string; subclassName: string; } | null;
      fees: {
        totalExpected: number; totalPaid: number; outstanding: number;
        dueDate: string | null; daysOverdue: number;
        urgency: 'PAID' | 'OK' | 'OVERDUE';
      };
      attendance: { totalAbsences: number; unexcusedAbsences: number; atRisk: boolean; };
      discipline: { activeIssues: number; };
    }>;
  };
}
```

**Errors:** `401 Unauthorized`, `403 Forbidden` (not a PARENT).

---

### Child Timetable (weekly schedule)
```http
GET /api/v1/parents/:matricule/timetable?academicYearId=..
```

Returns the child's weekly `TeacherPeriod` schedule, both as a flat `periods`
list and grouped by `days` in Monday→Sunday order for direct rendering.

**Response (200):**
```typescript
{
  success: true;
  data: {
    student: { id: number; matricule: string; name: string; };
    enrollment: { academicYearId: number; className: string; subclassName: string; } | null;
    periods: Array<{
      teacherPeriodId: number;
      dayOfWeek: 'MONDAY' | 'TUESDAY' | ... | 'SUNDAY';
      periodName: string;
      periodSequence: number;
      startTime: string;   // "08:00"
      endTime: string;     // "08:45"
      periodType: 'TEACHING' | 'BREAK' | 'PREP';
      subject: { id: number; name: string; category: string; } | null;
      teacher: { id: number; name: string; matricule: string; } | null;
    }>;
    days: Array<{ day: string; periods: [...] }>;
  };
}
```

If the child has no enrollment in the requested year, `enrollment` is `null`
and `periods`/`days` are empty arrays (not an error).

---

### Discipline — Warnings
```http
GET /api/v1/parents/:matricule/warnings?academicYearId=..
```

Progressive warnings (`StudentWarning`) issued to the child, ordered newest first.

**Response (200):**
```typescript
{
  success: true;
  data: {
    summary: { total: number; active: number; resolved: number; highestLevel: number; };
    items: Array<{
      id: number;
      warningLevel: number;
      reason: 'ABSENCE_THRESHOLD' | 'BEHAVIOR' | 'ACADEMIC' | ...;
      description: string;
      triggerAbsenceCount: number | null;
      issuedBy: string | null;
      resolved: boolean;
      resolvedAt: string | null;
      resolvedNotes: string | null;
      createdAt: string;
    }>;
  };
}
```

### Discipline — Summons
```http
GET /api/v1/parents/:matricule/summons?academicYearId=..
```

`ParentSummons` records auto-created on consecutive/cumulative unexcused
absences or issued manually by DM/admin.

**Response (200):**
```typescript
{
  success: true;
  data: {
    summary: {
      total: number;
      pending: number;
      actionRequired: boolean;   // true if any PENDING/SCHEDULED summons has a future or missing date
    };
    items: Array<{
      id: number;
      reason: string;
      triggerType: 'CONSECUTIVE_ABSENCES' | 'CUMULATIVE_ABSENCES' | 'MANUAL';
      scheduledDate: string | null;
      status: 'PENDING' | 'SCHEDULED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
      attended: boolean | null;
      meetingNotes: string | null;
      parentName: string | null;
      createdBy: string | null;
      createdAt: string;
    }>;
  };
}
```

### Discipline — Disciplinary Actions
```http
GET /api/v1/parents/:matricule/disciplinary-actions?academicYearId=..
```

Suspensions, work duties, dismissals, disciplinary council referrals.

**Response (200):**
```typescript
{
  success: true;
  data: {
    summary: { total: number; active: number; pending: number; completed: number; };
    items: Array<{
      id: number;
      actionType: 'SUSPENSION' | 'WORK_DUTY' | 'SUSPENDED_WITH_CHORES' | 'PUNISHMENT'
                | 'DISMISSAL' | 'SUSPENDED_DISMISSAL' | 'END_OF_YEAR_DISMISSAL'
                | 'DISCIPLINARY_COUNCIL';
      status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
      days: number | null;
      startDate: string | null;
      endDate: string | null;
      reason: string;
      notes: string | null;
      decidedBy: string | null;
      linkedIssue: { id: number; issueType: string; description: string; } | null;
      createdAt: string;
    }>;
  };
}
```

### Discipline — Saturday Punishments
```http
GET /api/v1/parents/:matricule/saturday-punishments?academicYearId=..
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    summary: { total: number; pending: number; served: number; };
    items: Array<{
      id: number;
      reason: string;
      scheduledDate: string | null;
      servedDate: string | null;
      status: 'PENDING' | 'SERVED' | 'SKIPPED';
      notes: string | null;
      assignedBy: string | null;
      createdAt: string;
    }>;
  };
}
```

---

### Health Visits (Nurse log, paginated)
```http
GET /api/v1/parents/:matricule/health-visits?page=1&limit=20&academicYearId=..
```

Portal-mode paginated nurse-visit history. Also exposes the student's health
conditions and medical notes at the top for the frontend to render as an
allergy/condition banner.

**Response (200):**
```typescript
{
  success: true;
  data: {
    student: {
      id: number; matricule: string; name: string;
      healthConditions: Array<'SICKLE_CELL' | 'ASTHMATIC' | 'EPILEPTIC' | 'DIABETIC' | 'ALLERGY' | 'HYPERTENSION' | 'OTHER'>;
      medicalNotes: string | null;
    };
    meta: { page: number; limit: number; total: number; totalPages: number; };
    items: Array<{
      id: number;
      visitDate: string;
      reason: string;
      treatmentGiven: string | null;
      medicationGiven: string | null;
      sentHome: boolean;
      notes: string | null;
      period: { name: string; dayOfWeek: string; startTime: string; endTime: string; } | null;
      loggedBy: string | null;
    }>;
  };
}
```

Authenticated parents can also call `GET /api/v1/nurses/students/:studentId/health-profile`
directly — the `PARENT` role is now permitted on that endpoint. Service-side
scoping ensures they only see their own children.

---

### Response Shape Changes (Existing Endpoints)

The following existing endpoints now return additional fields. Old fields
are unchanged, so this is fully backwards-compatible.

**`GET /api/v1/parents/:matricule/details`** — `attendance` and `fees` are richer:

```typescript
attendance: {
  presentDays: number;
  absentDays: number;   // now = count of CLASS_ABSENCE only
  lateDays: number;     // now = count of MORNING_LATENESS (was hardcoded to 5)
  attendanceRate: number;
}

fees: {
  totalExpected: number;
  totalPaid: number;
  outstandingBalance: number;
  dueDate: string | null;                             // NEW
  daysOverdue: number;                                // NEW
  urgency: 'PAID' | 'OK' | 'DUE_SOON' | 'OVERDUE';   // NEW
  lastPaymentDate?: string;
  paymentHistory: Array<PaymentRecord>;
  items: Array<{                                      // NEW itemized breakdown
    id: number;
    name: string;
    description: string | null;
    scope: 'ALL' | 'CLASS' | 'SUBCLASS' | 'STUDENT';
    amountExpected: number;
    amountPaid: number;
    outstanding: number;
    status: 'PAID' | 'PARTIAL' | 'UNPAID';
  }>;
}
```

**`GET /api/v1/parents/:matricule/analytics`** — `attendanceAnalytics` now returns:

```typescript
attendanceAnalytics: {
  overallAttendanceRate: string;
  totalAbsences: number;
  classAbsences: number;         // NEW
  morningLateness: number;       // NEW
  excusedCount: number;          // NEW
  unexcusedCount: number;        // NEW
  atRisk: boolean;               // NEW — true when unexcusedCount >= 3
  monthlyTrends: [...];
  attendanceStatus: string;
  recentAbsences: Array<{        // NEW extra fields
    id: number;
    date: string;
    type: 'CLASS_ABSENCE' | 'MORNING_LATENESS';
    isExcused: boolean;
    excuseReason: string | null;
    excusedAt: string | null;
    makeupStatus: 'NONE' | 'PENDING' | 'COMPLETED' | 'WAIVED';
    makeupCompletedAt: string | null;
  }>;
}
```

**`GET /api/v1/parents/:matricule/overview`** — the `academic.sequenceAverages`
array (already returned) exposes per-sequence class ranking that the frontend
should now surface: `rank`, `totalStudents`, `decision`.

---

## Quiz System

### Create Quiz (Teachers/Admin)
```http
POST /api/v1/quiz
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  title: string;
  description?: string;
  subjectId: number;
  classIds: number[];    // Array of class IDs
  timeLimit?: number;    // Minutes
  totalMarks?: number;   // Defaults to 10
  startDate?: string;    // "YYYY-MM-DD"
  endDate?: string;      // "YYYY-MM-DD"
  questions: Array<{
    questionText: string;
    questionType?: "MCQ" | "LONG_ANSWER"; // Defaults to MCQ
    options?: string[];   // For MCQ questions
    correctAnswer: string;
    marks?: number;       // Defaults to 1
    explanation?: string;
  }>;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Quiz created successfully";
  data: {
    id: number;
    title: string;
    description?: string;
    subjectId: number;
    classIds: string;    // JSON string
    timeLimit?: number;
    totalMarks: number;
    startDate?: string;
    endDate?: string;
    createdById: number;
    academicYearId: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    questions: Array<{
      id: number;
      quizId: number;
      questionText: string;
      questionType: "MCQ" | "LONG_ANSWER";
      options?: string;   // JSON string for MCQ
      correctAnswer: string;
      marks: number;
      orderIndex: number;
      explanation?: string;
    }>;
    subject: {
      id: number;
      name: string;
      // ... other subject fields
    };
    createdBy: {
      id: number;
      name: string;
      matricule: string;
    };
  };
}
```

### Get Available Quizzes for Student
```http
GET /api/v1/quiz/student/:studentId/available
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    title: string;
    description?: string;
    subject: string;
    timeLimit?: number;
    totalMarks: number;
    questionCount: number;
    startDate?: string;
    endDate?: string;
    status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
    lastAttempt?: {
      score: number;
      percentage: number;
    };
  }>;
}
```

### Start Quiz
```http
POST /api/v1/quiz/start
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  quizId: number;
  studentId: number;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Quiz started successfully";
  data: {
    id: number;
    quizId: number;
    studentId: number;
    parentId: number;
    status: "IN_PROGRESS";
    startedAt: string;
    // ... submission details
  };
}
```

### Submit Quiz
```http
POST /api/v1/quiz/submissions/:submissionId/submit
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  responses: Array<{
    questionId: number;
    selectedAnswer: string;
    timeSpent?: number; // Seconds
  }>;
}
```

### Get Quiz Results
```http
GET /api/v1/quiz/student/:studentId/results
Authorization: Bearer <token>
```

### Get Detailed Quiz Results
```http
GET /api/v1/quiz/submissions/:submissionId/detailed
Authorization: Bearer <token>
```

### Get Quiz Statistics (Teachers)
```http
GET /api/v1/quiz/:quizId/statistics
Authorization: Bearer <token>
```

### Get All Quizzes (Teachers/Admin)
```http
GET /api/v1/quiz
Authorization: Bearer <token>
```

---

## Vice Principal (Enhanced Student Management)

### Get Vice Principal Dashboard
```http
GET /api/v1/vice-principal/dashboard
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStudents: number;
    studentsAssigned: number;
    pendingInterviews: number;
    completedInterviews: number;
    awaitingAssignment: number;
    recentDisciplineIssues: number;
    classesWithPendingReports: number;
    teacherAbsences: number;
    enrollmentTrends: {
      thisMonth: number;
      lastMonth: number;
      trend: "INCREASING" | "DECREASING" | "STABLE";
    };
    subclassCapacityUtilization: Array<{
      subclassName: string;
      className: string;
      currentCapacity: number;
      maxCapacity: number;
      utilizationRate: number;
    }>;
    urgentTasks: Array<{
      type: "INTERVIEW_OVERDUE" | "ASSIGNMENT_PENDING" | "CAPACITY_EXCEEDED";
      description: string;
      priority: "HIGH" | "MEDIUM" | "LOW";
      count: number;
    }>;
  };
}
```

### Get Student Management Overview
```http
GET /api/v1/vice-principal/student-management
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStudents: number;
    byStatus: {
      notEnrolled: number;
      interviewPending: number;
      interviewCompleted: number;
      assignedToClass: number;
      enrolled: number;
    };
    interviewMetrics: {
      totalConducted: number;
      averageScore: number;
      passRate: number;
      pendingInterviews: number;
      overdueInterviews: number;
    };
    classAssignmentMetrics: {
      totalAssigned: number;
      awaitingAssignment: number;
      classCapacityIssues: number;
      recentAssignments: number;
    };
  };
}
```

### Get Interview Management Data
```http
GET /api/v1/vice-principal/interviews
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  status?: "PENDING" | "COMPLETED" | "OVERDUE";
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    studentId: number;
    studentName: string;
    studentMatricule: string;
    className: string;
    interviewStatus: "PENDING" | "COMPLETED" | "OVERDUE";
    scheduledDate?: string;
    completedDate?: string;
    score?: number;
    comments?: string;
    interviewerName?: string;
    daysOverdue?: number;
    registrationDate: string;
  }>;
  count: number;
}
```

### Get Subclass Optimization
```http
GET /api/v1/vice-principal/subclass-optimization
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    classId: number;
    className: string;
    subclasses: Array<{
      id: number;
      name: string;
      currentEnrollment: number;
      maxCapacity: number;
      utilizationRate: number;
      availableSpots: number;
      status: "OPTIMAL" | "UNDERUTILIZED" | "OVERLOADED" | "FULL";
      recommendations: Array<string>;
    }>;
    overallUtilization: number;
    recommendations: Array<{
      type: "BALANCE_ENROLLMENT" | "CREATE_SUBCLASS" | "MERGE_SUBCLASS";
      description: string;
      priority: "HIGH" | "MEDIUM" | "LOW";
    }>;
  }>;
}
```

### Get Student Progress Tracking
```http
GET /api/v1/vice-principal/student-progress/:studentId
Authorization: Bearer <token>
```

**Path Parameters:**
- `studentId` (number): Student ID

**Response (200):**
```typescript
{
  success: true;
  data: {
    studentId: number;
    studentName: string;
    matricule: string;
    enrollmentJourney: Array<{
      stage: "REGISTERED" | "INTERVIEWED" | "ASSIGNED" | "ENROLLED";
      date: string;
      details: string;
      completedBy?: string;
    }>;
    currentStatus: string;
    nextAction: string;
    daysInCurrentStage: number;
    alerts: Array<string>;
  };
}
```

### Bulk Schedule Interviews
```http
POST /api/v1/vice-principal/bulk-schedule-interviews
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  studentIds: number[];
  scheduledDate: string; // "YYYY-MM-DD"
  academicYearId?: number;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Successfully scheduled X interviews";
  data: {
    scheduled: number;
    errors: Array<{
      studentId: number;
      error: string;
    }>;
  };
}
```

### Get Enrollment Analytics
```http
GET /api/v1/vice-principal/enrollment-analytics
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    enrollmentTrends: Array<{
      date: string;
      count: number;
    }>;
    genderDistribution: Array<{
      gender: "MALE" | "FEMALE";
      count: number;
    }>;
    ageDistribution: Array<{
      ageRange: string;
      count: number;
    }>;
    classDistribution: Array<{
      classId: number;
      enrollmentCount: number;
      lastEnrollment: string;
    }>;
  };
}
```

### Get Students Requiring Attention
```http
GET /api/v1/vice-principal/students-requiring-attention
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    pendingInterviews: {
      count: number;
      students: Array<object>; // Limited to 10
    };
    overdueInterviews: {
      count: number;
      students: Array<object>;
    };
    awaitingAssignment: {
      count: number;
      students: Array<object>;
    };
    totalRequiringAttention: number;
  };
}
```

### Get Class Capacity Analysis
```http
GET /api/v1/vice-principal/class-capacity-analysis
Authorization: Bearer <token>
```

### Get Quick Statistics
```http
GET /api/v1/vice-principal/quick-stats
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStudents: number;
    studentsAssigned: number;
    pendingInterviews: number;
    awaitingAssignment: number;
    completionRate: number;
    interviewCompletionRate: number;
    urgentTasksCount: number;
    enrollmentTrend: "INCREASING" | "DECREASING" | "STABLE";
    averageInterviewScore: number;
  };
}
```

---

## Enrollment Workflow (Basic Operations)

### Register Student to Class (Bursar Function)
```http
POST /api/v1/enrollment/register
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  name: string;
  dateOfBirth: string;     // "YYYY-MM-DD"
  placeOfBirth: string;
  gender: "MALE" | "FEMALE";
  residence: string;
  formerSchool?: string;
  classId: number;          // Required
  academicYearId?: number; // Optional, defaults to current
  isNewStudent?: boolean;  // Defaults to true
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Student registered successfully. Awaiting VP interview.";
  data: {
    student: {
      id: number;
      matricule: string;
      name: string;
      dateOfBirth: string;
      placeOfBirth: string;
      gender: "MALE" | "FEMALE";
      residence: string;
      formerSchool?: string;
      isNewStudent: boolean;
      status: "NOT_ENROLLED";
      // ... other fields
    };
    enrollment: {
      id: number;
      studentId: number;
      classId: number;
      subClassId?: number; // null until VP assigns
      academicYearId: number;
      // ... other enrollment fields
    };
  };
}
```

### Record Interview Mark
```http
POST /api/v1/enrollment/interview
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  studentId: number;
  score: number;             // Interview score
  comments?: string;
  academicYearId?: number;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Interview mark recorded successfully. Student ready for subclass assignment.";
  data: {
    id: number;
    studentId: number;
    interviewerId: number;
    score: number;
    comments?: string;
    academicYearId: number;
    interviewDate: string;
  };
}
```

### Assign Student to Subclass
```http
POST /api/v1/enrollment/assign-subclass
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  studentId: number;
  subClassId: number;
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Student successfully assigned to subclass. Enrollment complete.";
  data: {
    enrollment: {
      id: number;
      studentId: number;
      classId: number;
      subClassId: number;
      academicYearId: number;
      status: "ASSIGNED_TO_CLASS";
      // ... updated enrollment
    };
  };
}
```

### Get Unassigned Students
```http
GET /api/v1/enrollment/unassigned
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Unassigned students retrieved successfully";
  data: Array<{
    id: number;
    name: string;
    matricule: string;
    dateOfBirth: string;
    className: string;
    interviewStatus: "PENDING" | "COMPLETED";
    interviewScore?: number;
    registrationDate: string;
  }>;
  count: number;
}
```

### Get Available Subclasses
```http
GET /api/v1/enrollment/available-subclasses/:classId
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Available subclasses retrieved successfully";
  data: Array<{
    id: number;
    name: string;
    capacity: number;
    currentEnrollment: number;
    availableSpots: number;
    classId: number;
    className: string;
  }>;
}
```

### Get Enrollment Statistics
```http
GET /api/v1/enrollment/stats
Authorization: Bearer <token>
```

### Get Student Enrollment Status
```http
GET /api/v1/enrollment/student/:studentId/status
Authorization: Bearer <token>
```

---

## Bursar (Financial Management)

### Create Student with Parent Account (NEW - Parent Creation Workflow)
```http
POST /api/v1/bursar/create-parent-with-student
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  studentName: string;
  dateOfBirth: string;     // "YYYY-MM-DD"
  placeOfBirth: string;
  gender: "MALE" | "FEMALE";
  residence: string;
  formerSchool?: string;
  classId: number;
  isNewStudent?: boolean;  // Defaults to true
  academicYearId?: number; // Optional, defaults to current
  parentName: string;
  parentPhone: string;
  parentWhatsapp?: string;
  parentEmail?: string;
  parentAddress: string;
  relationship?: string;   // Defaults to "PARENT"
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Student and parent created successfully";
  data: {
    student: {
      id: number;
      matricule: string;
      name: string;
      dateOfBirth: string;
      placeOfBirth: string;
      gender: "MALE" | "FEMALE";
      residence: string;
      formerSchool?: string;
      isNewStudent: boolean;
      status: "NOT_ENROLLED";
      // ... other student fields
    };
    parent: {
      id: number;
      matricule: string;      // Generated parent matricule
      name: string;
      email?: string;
      phone: string;
      tempPassword: string;   // Temporary password for parent
      // ... other parent fields
    };
    enrollment?: {
      id: number;
      studentId: number;
      classId: number;
      academicYearId: number;
      // ... enrollment details
    };
  };
}
```

### Get Available Parents for Linking
```http
GET /api/v1/bursar/available-parents
Authorization: Bearer <token>
```

**Description:**
Retrieves a paginated list of existing parent accounts that can be linked to students. Supports searching by name, phone, or email.

**Authorization:**
- `BURSAR`, `SUPER_MANAGER`

**Query Parameters:**
```typescript
{
  search?: string;        // Optional: Search term for parent name, phone, or email.
  limit?: number;         // Optional: Number of results to return (default: 20).
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Available parents retrieved successfully";
  data: Array<{
    id: number;
    matricule: string;
    name: string;
    email?: string;
    phone: string;
    address?: string;
    childrenCount: number;
    children: Array<{
      id: number;
      name: string;
      className?: string;
    }>;
  }>;
  count: number; // Total number of parents matching the criteria
}
```

**Error Response (500):**
```typescript
{
  success: false;
  error: "Error fetching available parents: [error message]";
}
```

### Link Existing Parent to Student
```http
POST /api/v1/bursar/link-existing-parent
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  studentId: number;
  parentId: number;
  relationship?: string;   // Defaults to "PARENT"
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Parent linked to student successfully";
  data: {
    id: number;
    studentId: number;
    parentId: number;
    relationship: string;
    createdAt: string;
  };
}
```

### Get Bursar Dashboard
```http
GET /api/v1/bursar/dashboard
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalFeesExpected: number;
    totalFeesCollected: number;
    pendingPayments: number;
    collectionRate: number;
    recentTransactions: number;
    newStudentsThisMonth: number;
    studentsWithParents: number;
    studentsWithoutParents: number;
    paymentMethods: Array<{
      method: string;
      count: number;
      totalAmount: number;
    }>;
    recentRegistrations: Array<{
      studentName: string;
      parentName: string;
      registrationDate: string;
      className: string;
    }>;
  };
}
```

### Create Fee
```http
POST /api/v1/fees
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  enrollmentId: number;
  amountExpected: number;
  feeType?: string;
  description?: string;
  dueDate?: string;       // "YYYY-MM-DD"
  academicYearId?: number;
}
```

### Record Payment
```http
POST /api/v1/fees/:feeId/payments
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  amount: number;
  paymentDate: string;    // "YYYY-MM-DD" (from receipt)
  paymentMethod: "EXPRESS_UNION" | "CCA" | "3DC";
  receiptNumber?: string;
  recordedById?: number; // Auto-set from auth
  notes?: string;
}
```

**Response (201):**
```typescript
{
  success: true;
  data: {
    id: number;
    feeId: number;
    amount: number;
    paymentDate: string;
    paymentMethod: string;
    receiptNumber?: string;
    recordedById: number;
    notes?: string;
    createdAt: string;
  };
}
```

### Get Student Fees
```http
GET /api/v1/fees/student/:studentId
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

### Get Subclass Fees Summary
```http
GET /api/v1/fees/subclass/:subClassId/summary
Authorization: Bearer <token>
```

**Description:**
Retrieves a financial summary of fees for all students within a specific subclass for a given academic year. This endpoint supports both the `/api/v1/fees/subclass/:id/summary` and `/api/v1/fees/sub_class/:id/summary` paths for backward compatibility.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `id` (number): The ID of the subclass.

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year.
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    subClassId: number;
    subClassName: string;
    className: string;
    academicYearId: number;
    totalStudentsWithFees: number;
    totalExpected: number;
    totalPaid: number;
    outstanding: number;
    paymentPercentage: number;
  };
}
```

**Error Response (500):**
```typescript
{
  success: false;
  error: "Academic year ID is required to fetch subclass fees summary, but none was provided or found." | "Error fetching subclass fees summary: [error message]";
}
```

### Get All Fees
```http
GET /api/v1/fees
Authorization: Bearer <token>
```

**Description:**
Retrieves a paginated list of all fee records with extensive filtering capabilities.

**Authorization:**
- Any authenticated user (access might be restricted based on role, e.g., TEACHER can only see fees related to their students/classes if configured).

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year if not provided.
  page?: number; // Optional: Page number for pagination.
  limit?: number; // Optional: Number of items per page for pagination.
  search?: string; // Optional: Search term for student name or parent name.
  studentIdentifier?: string; // Optional: Search by student name or matricule.
  classId?: number; // Optional: Filter by class ID.
  subClassId?: number; // Optional: Filter by subclass ID.
  className?: string; // Optional: Filter by class name (case-insensitive).
  subclassName?: string; // Optional: Filter by subclass name (case-insensitive).
  dueDate?: string; // Optional: Fees due on or before this date (YYYY-MM-DD).
  dueBeforeDate?: string; // Optional: Fees due on or before this date (YYYY-MM-DD).
  dueAfterDate?: string; // Optional: Fees due on or after this date (YYYY-MM-DD).
  paymentStatus?: "paid" | "partial" | "unpaid"; // Optional: Filter by payment status.
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    data: Array<{
      id: number;
      amountExpected: number;
      amountPaid: number;
      dueDate: string;
      enrollmentId: number;
      academicYearId: number;
      createdAt: string;
      updatedAt: string;
      enrollment: {
        id: number;
        studentId: number;
        academicYearId: number;
        subClassId: number;
        student: {
          id: number;
          name: string;
          matricule: string;
          // ... other student details
        };
        subClass: {
          id: number;
          name: string;
          classId: number;
          class: {
            id: number;
            name: string;
          };
        };
      };
      academicYear: {
        id: number;
        name: string;
        startDate: string;
        endDate: string;
      };
      paymentTransactions: Array<{
        id: number;
        amount: number;
        paymentDate: string;
        receiptNumber?: string;
        paymentMethod: "EXPRESS_UNION" | "CCA" | "F3DC";
        feeId: number;
        recordedById?: number;
        createdAt: string;
        updatedAt: string;
      }>;
    }>;
    meta: {
      total: number;
      lastPage: number;
      currentPage: number;
      perPage: number;
    };
  };
}
```

### Export Fee Reports
```http
GET /api/v1/fees/export
Authorization: Bearer <token>
```

**Description:**
Exports fee data in specified formats (CSV, PDF, DOCX) based on various filters.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `BURSAR`

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year if not provided.
  subClassId?: number; // Optional: Filter by subclass ID.
  classId?: number; // Optional: Filter by class ID.
  studentIdentifier?: string; // Optional: Filter by student name or matricule.
  paymentStatus?: "paid" | "partial" | "unpaid"; // Optional: Filter by payment status.
  format?: "csv" | "pdf" | "docx"; // Optional: Output format. Defaults to "csv".
}
```

**Response (Success - 200 - File Download):**
```
Content-Type: text/csv | application/pdf | application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="fee_report_<academicYearId>.<format_extension>"

[File Content]
```

**Example Data in Report (JSON Structure before conversion):**
```typescript
{
  academicYearId: number;
  summary: {
    totalStudents: number;
    totalExpected: number;
    totalPaid: number;
    outstanding: number;
    paymentPercentage: number;
  };
  fees: Array<{
    feeId: number;
    studentName: string;
    studentMatricule: string;
    className: string;
    subClassName: string;
    expectedAmount: number;
    paidAmount: number;
    outstanding: number;
    paymentPercentage: number;
    dueDate: string;
    paymentsCount: number;
  }>;
}
```

### Get a Specific Fee by ID
```http
GET /api/v1/fees/:id
Authorization: Bearer <token>
```

**Description:**
Retrieves details of a specific fee record by its ID.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `id` (number): The ID of the fee record.

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    id: number;
    amountExpected: number;
    amountPaid: number;
    dueDate: string;
    enrollmentId: number;
    academicYearId: number;
    createdAt: string;
    updatedAt: string;
    enrollment: {
      id: number;
      studentId: number;
      academicYearId: number;
      subClassId: number;
      student: {
        id: number;
        name: string;
        matricule: string;
        // ... other student details
      };
      subClass: {
        id: number;
        name: string;
        classId: number;
        class: {
          id: number;
          name: string;
        };
      };
    };
    academicYear: {
      id: number;
      name: string;
      startDate: string;
      endDate: string;
    };
    paymentTransactions: Array<{
      id: number;
      amount: number;
      paymentDate: string;
      receiptNumber?: string;
      paymentMethod: "EXPRESS_UNION" | "CCA" | "F3DC";
      feeId: number;
      recordedById?: number;
      createdAt: string;
      updatedAt: string;
    }>;
  };
}
```

### Create a Fee Record
```http
POST /api/v1/fees
Authorization: Bearer <token>
```

**Description:**
Creates a new fee record for a student.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `BURSAR`

**Request Body:**
```typescript
{
  amountExpected: number;
  amountPaid: number;
  dueDate: string; // YYYY-MM-DD
  enrollmentId?: number; // Required if studentId is not provided
  studentId?: number; // Required if enrollmentId is not provided
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year.
  paymentMethod?: "EXPRESS_UNION" | "CCA" | "F3DC"; // Optional: Default payment method for the fee.
}
```

**Response (Success - 201):**
```typescript
{
  success: true;
  data: {
    id: number;
    amountExpected: number;
    amountPaid: number;
    dueDate: string;
    enrollmentId: number;
    academicYearId: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Update a Fee Record
```http
PUT /api/v1/fees/:id
Authorization: Bearer <token>
```

**Description:**
Updates an existing fee record.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `BURSAR`

**Path Parameters:**
- `id` (number): The ID of the fee record to update.

**Request Body:**
```typescript
{
  amountExpected?: number;
  amountPaid?: number;
  paymentMethod?: "EXPRESS_UNION" | "CCA" | "F3DC";
  dueDate?: string; // YYYY-MM-DD
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    id: number;
    amountExpected: number;
    amountPaid: number;
    dueDate: string;
    enrollmentId: number;
    academicYearId: number;
    createdAt: string;
    updatedAt: string;
    // ... potentially other included relations as per getFeeById
  };
}
```

### Delete a Fee Record
```http
DELETE /api/v1/fees/:id
Authorization: Bearer <token>
```

**Description:**
Deletes a fee record. Fails if there are existing payment transactions associated with it.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `BURSAR`

**Path Parameters:**
- `id` (number): The ID of the fee record to delete.

**Response (Success - 200):**
```typescript
{
  success: true;
  message: "Fee deleted successfully";
}
```

### Get All Fees for a Specific Student
```http
GET /api/v1/fees/student/:studentId
Authorization: Bearer <token>
```

**Description:**
Retrieves all fee records for a specific student for a given academic year.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `studentId` (number): The ID of the student.

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year.
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    amountExpected: number;
    amountPaid: number;
    dueDate: string;
    enrollmentId: number;
    academicYearId: number;
    createdAt: string;
    updatedAt: string;
    // ... potentially other included relations as per getFeeById
  }>;
}
```

### Get Fee Summary for a Subclass
```http
GET /api/v1/fees/subclass/:id/summary
GET /api/v1/fees/sub_class/:id/summary
Authorization: Bearer <token>
```

**Description:**
Retrieves a financial summary of fees for all students within a specific subclass for a given academic year. This endpoint supports both the `/api/v1/fees/subclass/:id/summary` and `/api/v1/fees/sub_class/:id/summary` paths for backward compatibility.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `id` (number): The ID of the subclass.

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year.
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    subClassId: number;
    subClassName: string;
    className: string;
    academicYearId: number;
    totalStudentsWithFees: number;
    totalExpected: number;
    totalPaid: number;
    outstanding: number;
    paymentPercentage: number;
  };
}
```

**Error Response (500):**
```typescript
{
  success: false;
  error: "Academic year ID is required to fetch subclass fees summary, but none was provided or found." | "Error fetching subclass fees summary: [error message]";
}
```

### Get All Payments for a Fee
```http
GET /api/v1/fees/:feeId/payments
Authorization: Bearer <token>
```

**Description:**
Retrieves all payment transactions associated with a specific fee record.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `feeId` (number): The ID of the fee record.

**Response (Success - 200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    amount: number;
    paymentDate: string;
    receiptNumber?: string;
    paymentMethod: "EXPRESS_UNION" | "CCA" | "F3DC";
    feeId: number;
    recordedById?: number;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

### Record a Payment for a Specific Fee (direct / legacy)
```http
POST /api/v1/fees/:feeId/payments
Authorization: Bearer <token>
```

**Description:**
Records a new payment transaction for a specific fee record and updates the fee's paid amount.

> **Preferred flow — user-driven claim + Bursar validation:**
> Parents (or Bursar+ on their behalf) submit a `PAYMENT_CLAIM` at
> `POST /api/v1/finance-requests`. Bursar/Principal/Manager/Super Manager
> receive a notification, then call `POST /api/v1/finance-requests/:id/approve`.
> The approval automatically creates the `PaymentTransaction` and updates
> `SchoolFees.amountPaid` — no separate call to this endpoint is needed.
> This direct endpoint remains for walk-in cash payments recorded at the desk.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `BURSAR`

**Path Parameters:**
- `feeId` (number): The ID of the fee record to record a payment for.

**Request Body:**
```typescript
{
  amount: number;
  paymentDate: string; // YYYY-MM-DD
  receiptNumber?: string; // Optional
  paymentMethod: "EXPRESS_UNION" | "CCA" | "F3DC";
  enrollmentId?: number; // Optional: Can be derived from feeId, but can be provided for clarity
  studentId?: number; // Optional: Can be derived from feeId, but can be provided for clarity
  academicYearId?: number; // Optional: Can be derived from feeId, but can be provided for clarity
}
```

**Response (Success - 201):**
```typescript
{
  success: true;
  data: {
    id: number;
    amount: number;
    paymentDate: string;
    receiptNumber?: string;
    paymentMethod: "EXPRESS_UNION" | "CCA" | "F3DC";
    feeId: number;
    recordedById?: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Edit a Payment Record
```http
PUT /api/v1/fees/payments/:paymentId
Authorization: Bearer <token>
```

**Description:**
Updates an existing payment transaction. When `amount` is changed, the parent fee's `amountPaid` is automatically adjusted by the delta (old vs. new amount) in the same transaction.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`: may edit at any time.
- `BURSAR`: may only edit within **2 days** of the payment's `createdAt` timestamp. Attempts after the window return `403`.

**Path Parameters:**
- `paymentId` (number): The ID of the payment transaction to edit.

**Request Body (all fields optional — send only what you want to change):**
```typescript
{
  amount?: number;
  paymentDate?: string;         // YYYY-MM-DD
  receiptNumber?: string | null;
  paymentMethod?: "EXPRESS_UNION" | "CCA" | "F3DC";
  notes?: string | null;
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  data: {
    id: number;
    amount: number;
    paymentDate: string;
    receiptNumber?: string;
    paymentMethod: "EXPRESS_UNION" | "CCA" | "F3DC";
    feeId: number;
    enrollmentId: number;
    academicYearId: number;
    recordedById: number;
    notes?: string;
    createdAt: string;
    updatedAt: string;
  };
}
```

**Error Responses:**
- `400`: Invalid `paymentId` or invalid `paymentMethod`.
- `403`: Bursar attempted to edit outside the 2-day window.
- `404`: Payment not found.

---

## Finance Requests (Approval Workflows)

All approval-driven financial actions run through a single endpoint family. Each
request has a `type`, a `payload` specific to that type, and a lifecycle
`PENDING → APPROVED | REJECTED | COMPLETED`. Approving certain types
(`PAYMENT_CLAIM`, `REFUND`) triggers the underlying financial record automatically —
callers do **not** also hit the direct payment/refund endpoints.

**Types & lifecycle:**

| Type | Creator | Approver / Actor | On approve, we auto-create… |
|---|---|---|---|
| `PAYMENT_CLAIM` | `PARENT` or Bursar+ | Bursar+ (approve/reject) | `PaymentTransaction` + updates `SchoolFees.amountPaid` |
| `REFUND` | Bursar+ | `SUPER_MANAGER` only (approve/reject) | `Refund` + decrements `SchoolFees.amountPaid` |
| `FEE_REDUCTION` | Bursar+ | Principal+ (approve/reject) | — (fee adjustment made manually after approval) |
| `PERSONNEL_DISBURSEMENT` | Bursar+ | Recipient or Principal+ (complete/reject) | — |
| `BANK_VERIFICATION` | Bursar+ | Any finance viewer (complete/reject) | — |

**Notifications fired automatically:**
- On create: recipients relevant to the type are notified with `category = APPROVAL_NEEDED`.
- On approve/reject: the requester is notified. On `PAYMENT_CLAIM` approve or `REFUND` approve, all linked parents of the affected student also receive a `FEE_UPDATE` notification.

### Create a Finance Request
```http
POST /api/v1/finance-requests
Authorization: Bearer <token>
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `BURSAR`, `PARENT`
(per-type creator role enforced in service).

**Request Body:**
```typescript
{
  type: "PAYMENT_CLAIM" | "REFUND" | "FEE_REDUCTION" | "PERSONNEL_DISBURSEMENT" | "BANK_VERIFICATION";
  amount?: number | null;      // required for all except BANK_VERIFICATION
  reason: string;              // required (used as Refund.reason when type=REFUND)
  notes?: string;
  payload: object;             // shape depends on type — see below
}
```

**Payload shapes:**

```typescript
// PAYMENT_CLAIM — parent (or Bursar+) submits proof of a payment.
// Approval creates a real PaymentTransaction.
{
  enrollmentId?: number;       // preferred
  studentId?: number;          // fallback: resolves to the student's current-year enrollment
  feeId?: number;              // optional: if omitted we pick the current-year SchoolFees row
  paymentMethod: "EXPRESS_UNION" | "CCA" | "F3DC" | "AFRILAND_FIRST_BANK";
  paymentDate: string;         // YYYY-MM-DD, date on the receipt
  receiptNumber?: string;
}
```

```typescript
// REFUND — Bursar initiates. Approval creates a real Refund and decrements SchoolFees.amountPaid.
{
  enrollmentId: number;
  refundMethod: "CASH" | "BANK_TRANSFER" | "MOBILE_MONEY" | "EXPRESS_UNION" | "CCA" | "F3DC" | "AFRILAND_FIRST_BANK";
  refundDate: string;          // YYYY-MM-DD
}
```

```typescript
// FEE_REDUCTION — Principal+ approves; adjust fee manually after.
{ enrollmentId: number; partnerName?: string; }
```

```typescript
// PERSONNEL_DISBURSEMENT — recipient confirms receipt.
{ recipientUserId: number; purpose: string; }
```

```typescript
// BANK_VERIFICATION — verifier checks the slip.
{ studentId: number; claimedAmount?: number; estimatedPaymentPeriod: string; }
```

**Response (Success - 201):**
```typescript
{
  success: true;
  data: {
    id: number;
    type: string;
    status: "PENDING";
    amount: number | null;
    reason: string;
    notes: string | null;
    payload: object;
    requestedById: number;
    actedById: number | null;
    actedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
}
```

**Error Responses:**
- `400`: Missing/invalid payload fields, creator role not permitted for the type, parent not linked to the student, refund amount exceeds current overpayment, etc.

### List Finance Requests
```http
GET /api/v1/finance-requests
Authorization: Bearer <token>
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `BURSAR`, `SECRETARY`, `FEE_AUDITOR`, `PARENT`.

**Query Parameters:**
- `type` — filter by `FinanceRequestType`
- `status` — `PENDING | APPROVED | REJECTED | COMPLETED`
- `requestedById` — filter by requester (parents typically pass their own id)
- `recipientUserId` — for `PERSONNEL_DISBURSEMENT`
- `studentId` — matches `payload.studentId`
- `page`, `limit`

### Get Finance Request by ID
```http
GET /api/v1/finance-requests/:id
Authorization: Bearer <token>
```

### Approve a Finance Request
```http
POST /api/v1/finance-requests/:id/approve
Authorization: Bearer <token>
Content-Type: application/json

{ "notes": "optional actor notes" }
```

- `PAYMENT_CLAIM`: **Bursar+** only. On success, a `PaymentTransaction` is created and `SchoolFees.amountPaid` is incremented.
- `REFUND`: **SUPER_MANAGER** only. On success, a `Refund` is created and `SchoolFees.amountPaid` is decremented.
- `FEE_REDUCTION`: **Principal+** only.

**Errors:**
- `403`: role not permitted for this type; request already `APPROVED/REJECTED/COMPLETED`.
- `400`: side-effect validation failed (e.g. refund amount now exceeds current overpayment because a concurrent record changed it).

### Reject a Finance Request
```http
POST /api/v1/finance-requests/:id/reject
Authorization: Bearer <token>
Content-Type: application/json

{ "notes": "why rejected (optional but recommended)" }
```

Same per-type role rules as approve.

### Complete a Finance Request
```http
POST /api/v1/finance-requests/:id/complete
Authorization: Bearer <token>
```

Used for `PERSONNEL_DISBURSEMENT` (recipient confirms receipt) and `BANK_VERIFICATION` (verifier marks the slip verified).

---

## Overpayments & Refunds (Read + SM Override)

The primary way to issue a refund is through a `REFUND` **finance request**
(see above). The endpoints below cover read-only overpayment reporting and a
`SUPER_MANAGER`-only direct-record override.

### List Overpaid Students
```http
GET /api/v1/fees/overpaid
Authorization: Bearer <token>
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `BURSAR`, `SECRETARY`, `FEE_AUDITOR`.

**Query Parameters:** `academicYearId`, `classId`, `subClassId`, `minOverpayment`, `page`, `limit`.

### Export Overpaid Students (Excel)
```http
GET /api/v1/fees/overpaid/export
Authorization: Bearer <token>
```

Same auth + filters as above. Returns an `.xlsx` file including parent contact info.

### Record Refund (Direct — SUPER_MANAGER override)
```http
POST /api/v1/fees/refunds
Authorization: Bearer <token>
```

> Prefer the `REFUND` finance-request flow. This endpoint is kept as a
> `SUPER_MANAGER`-only override for exceptional cases.

**Authorization:** `SUPER_MANAGER` only.

**Request Body:**
```typescript
{
  enrollmentId: number;
  amount: number;
  refundDate: string;   // YYYY-MM-DD
  refundMethod: "CASH" | "BANK_TRANSFER" | "MOBILE_MONEY" | "EXPRESS_UNION" | "CCA" | "F3DC" | "AFRILAND_FIRST_BANK";
  reason: string;
  notes?: string;
}
```

### List Refunds
```http
GET /api/v1/fees/refunds
Authorization: Bearer <token>
```

**Query Parameters:** `studentId`, `enrollmentId`, `academicYearId`, `from`, `to`, `page`, `limit`.

### Get Refund by ID
```http
GET /api/v1/fees/refunds/:id
Authorization: Bearer <token>
```

---

## Discipline Master/SDM

### Get All Discipline Issues
```http
GET /api/v1/discipline
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  studentId?: number;
  classId?: number;
  subClassId?: number;
  startDate?: string;     // "YYYY-MM-DD"
  endDate?: string;       // "YYYY-MM-DD"
  description?: string;    // Search term
  includeAssignedBy?: boolean;
  includeReviewedBy?: boolean;
  includeStudent?: boolean;
  academicYearId?: number;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}
```

### Record Discipline Issue
```http
POST /api/v1/discipline
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  studentId: number;
  issueType: string;       // e.g., "MISCONDUCT", "MORNING_LATENESS", "CLASS_ABSENCE", "OTHER"
  description: string;
  dateOccurred?: string;  // Defaults to today
  severity?: "LOW" | "MEDIUM" | "HIGH";
  actionTaken?: string;
  academicYearId?: number;
}
```

### Get Discipline History
```http
GET /api/v1/discipline/:studentId
Authorization: Bearer <token>
```

### Record Morning Lateness
```http
POST /api/v1/discipline/lateness
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  studentId: number;
  date?: string;           // Defaults to today
  arrivalTime: string;    // "HH:mm"
  reason?: string;
  academicYearId?: number;
}
```

### Record Bulk Morning Lateness
```http
POST /api/v1/discipline/lateness/bulk
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  students: Array<{
    studentId: number;
    arrivalTime: string;  // "HH:mm"
    reason?: string;
  }>;
  date?: string;           // Defaults to today
  academicYearId?: number;
}
```

### Get Lateness Statistics
```http
GET /api/v1/discipline/lateness/statistics
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  startDate?: string;
  endDate?: string;
  classId?: number;
  subClassId?: number;
  academicYearId?: number;
}
```

### Get Daily Lateness Report
```http
GET /api/v1/discipline/lateness/daily-report
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  date?: string;           // Defaults to today
  academicYearId?: number;
}
```

---

### Excuse Absence (Parent Justification)
```http
POST /api/v1/discipline/absences/:id/excuse
Authorization: Bearer <token>
```
Marks a `StudentAbsence` as parent-excused. Excused absences do NOT count toward
warning/summons thresholds. If a warning or summons was previously fired based
on the now-excused row and no longer stands, the service auto-resolves the
warning and cancels the summons (audit trail preserved via `meeting_notes`).

**Authorized roles:** `SUPER_MANAGER, MANAGER, PRINCIPAL, VICE_PRINCIPAL, DEAN_OF_DISCIPLINE, DISCIPLINE_MASTER, SENIOR_DISCIPLINE_MASTER, PARENT` (parents may only excuse their own linked students' absences).

**Body:**
```typescript
{
  excusedByParentId?: number; // Defaults to caller if PARENT
  excuseReason?: string;
}
```

**Response:**
```typescript
{
  success: true;
  data: {
    absence: StudentAbsence;   // updated row with is_excused=true
    revertedWarnings: number;  // number of warnings auto-resolved
    cancelledSummons: number;  // number of summons auto-cancelled
  }
}
```

---

### Record Student Makeup
```http
POST /api/v1/discipline/absences/:id/makeup
Authorization: Bearer <token>
```
Records the student-side academic recovery for an absence. Independent of
parent excuse — does NOT affect warnings or summons.

**Authorized roles:** `TEACHER, DEAN_OF_DISCIPLINE, DISCIPLINE_MASTER, SENIOR_DISCIPLINE_MASTER, PRINCIPAL, VICE_PRINCIPAL, MANAGER, SUPER_MANAGER`.

**Body:**
```typescript
{
  status: 'PENDING' | 'COMPLETED' | 'WAIVED' | 'NONE';
  makeupNotes?: string;
}
```

---

### List Student Warnings
```http
GET /api/v1/discipline/warnings
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  enrollmentId?: number;
  studentId?: number;
  subClassId?: number;
  resolved?: boolean;         // filter by resolution state
  academicYearId?: number;
}
```

---

### Create Warning (Manual)
```http
POST /api/v1/discipline/warnings
Authorization: Bearer <token>
```

**Body:**
```typescript
{
  enrollmentId: number;
  warningLevel?: number;      // Default 1
  reason: 'CUMULATIVE_ABSENCES' | 'CHRONIC_LATENESS' | 'MISCONDUCT' | 'OTHER';
  description: string;
}
```

---

### Resolve Warning
```http
PATCH /api/v1/discipline/warnings/:id/resolve
Authorization: Bearer <token>
```

**Body:**
```typescript
{
  resolvedNotes?: string;
}
```

---

### List Parent Summons
```http
GET /api/v1/discipline/summons
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  enrollmentId?: number;
  studentId?: number;
  subClassId?: number;
  status?: 'PENDING' | 'SCHEDULED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
  academicYearId?: number;
}
```

---

### Create Summons (Manual)
```http
POST /api/v1/discipline/summons
Authorization: Bearer <token>
```

**Body:**
```typescript
{
  enrollmentId: number;
  parentId?: number;          // Defaults to preferred parent (FATHER > MOTHER > any)
  reason: string;
  scheduledDate?: string;     // ISO date
}
```

---

### Update Summons
```http
PUT /api/v1/discipline/summons/:id
Authorization: Bearer <token>
```

**Body (all optional):**
```typescript
{
  status?: 'PENDING' | 'SCHEDULED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
  scheduledDate?: string | null;
  meetingNotes?: string;
  attended?: boolean;
  parentId?: number | null;
}
```

---

### DM Roll Call — Get Slot Status
```http
GET /api/v1/discipline/dm-roll-call/status?subClassId=3&date=2026-07-21
Authorization: Bearer <token>
```
Returns a per-slot map showing which of SLOT_2 / SLOT_5 / SLOT_8 have been
recorded for a given sub-class and date. Discipline Masters are enforced to
only query sub-classes they've been assigned to via `RoleAssignment`.

---

### DM Roll Call — Get Roster + Attendance
```http
GET /api/v1/discipline/dm-roll-call?subClassId=3&date=2026-07-21&slot=SLOT_2
Authorization: Bearer <token>
```

Returns the full enrolled roster of the sub-class with each student's
recorded status (`PRESENT` / `LATE` / `ABSENT`) or `null` if not yet marked.

---

### DM Roll Call — Record
```http
POST /api/v1/discipline/dm-roll-call
Authorization: Bearer <token>
```

Records (or replaces) a slot roll call. On `ABSENT`, creates or reuses a
`StudentAbsence(CLASS_ABSENCE, teacher_period_id=null)` and fires
`evaluateAbsenceTriggers` → possible `StudentWarning` / `ParentSummons` auto-creation.
On `LATE` at `SLOT_2`, creates `StudentAbsence(MORNING_LATENESS)`.
On `LATE` at `SLOT_5` / `SLOT_8`, records a `DisciplineIssue(MISCONDUCT, "Late return after break")`.

**Body:**
```typescript
{
  subClassId: number;
  date: string;            // ISO date; normalized to UTC midnight
  slot: 'SLOT_2' | 'SLOT_5' | 'SLOT_8';
  entries: Array<{
    enrollmentId: number;
    status: 'PRESENT' | 'LATE' | 'ABSENT';
  }>;
  academicYearId?: number; // Defaults to current year
}
```

**Response:**
```typescript
{
  success: true;
  data: {
    rollCall: DMRollCall;
    triggers: Array<{
      enrollmentId: number;
      warnings: StudentWarning[];  // any newly-created warnings
      summons: ParentSummons[];    // any newly-created summons
    }>;
  }
}
```

---

## Enhanced Messaging System

### Get Messaging Dashboard
```http
GET /api/v1/messaging/dashboard
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalThreads: number;
    unreadMessages: number;
    urgentMessages: number;
    activeThreads: number;
    recentActivity: number;
    messagesByCategory: Array<{
      category: string;
      count: number;
      unreadCount: number;
    }>;
    quickStats: {
      sentToday: number;
      receivedToday: number;
      pendingResponses: number;
      resolvedToday: number;
    };
    recentThreads: Array<MessageThread>;
    urgentAlerts: Array<{
      id: number;
      subject: string;
      sender: string;
      priority: string;
      sentAt: string;
      category: string;
    }>;
  };
}
```

### Get Message Threads
```http
GET /api/v1/messaging/threads
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  category?: string;     // "GENERAL" | "ACADEMIC" | "DISCIPLINARY" | "FINANCIAL" | "ADMINISTRATIVE" | "EMERGENCY"
  priority?: string;     // "LOW" | "MEDIUM" | "HIGH" | "URGENT"
  status?: string;       // "ACTIVE" | "RESOLVED" | "ARCHIVED"
  search?: string;       // Search in subject, preview, tags
  page?: number;         // Default: 1
  limit?: number;        // Default: 20
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    subject: string;
    participants: Array<{
      userId: number;
      userName: string;
      userRole: string;
      isActive: boolean;
      lastReadAt?: string;
    }>;
    messageCount: number;
    lastMessageAt: string;
    lastMessagePreview: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    category: "GENERAL" | "ACADEMIC" | "DISCIPLINARY" | "FINANCIAL" | "ADMINISTRATIVE" | "EMERGENCY";
    status: "ACTIVE" | "RESOLVED" | "ARCHIVED";
    tags: Array<string>;
    createdAt: string;
    createdBy: {
      id: number;
      name: string;
      role: string;
    };
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

### Create Message Thread
```http
POST /api/v1/messaging/threads
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  subject: string;
  participants: Array<number>;
  category?: string;     // Default: "GENERAL"
  priority?: string;     // Default: "MEDIUM"
  initialMessage: string;
  tags?: Array<string>;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Message thread created successfully";
  data: MessageThread;
}
```

### Get Thread Messages
```http
GET /api/v1/messaging/threads/:threadId/messages
Authorization: Bearer <token>
```

**Path Parameters:**
- `threadId` (number): Thread ID

**Query Parameters:**
```typescript
{
  page?: number;         // Default: 1
  limit?: number;        // Default: 50
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    threadId: number;
    senderId: number;
    senderName: string;
    senderRole: string;
    content: string;
    messageType: "TEXT" | "ANNOUNCEMENT" | "ALERT" | "REMINDER" | "URGENT";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    isRead: boolean;
    readAt?: string;
    readBy: Array<{
      userId: number;
      userName: string;
      readAt: string;
    }>;
    attachments: Array<{
      id: number;
      fileName: string;
      fileUrl: string;
      fileSize: number;
      uploadedAt: string;
    }>;
    reactions: Array<{
      userId: number;
      userName: string;
      reaction: "👍" | "👎" | "❤️" | "😂" | "😮" | "😢" | "😡";
      reactedAt: string;
    }>;
    mentions: Array<{
      userId: number;
      userName: string;
      position: number;
    }>;
    deliveryStatus: "SENT" | "DELIVERED" | "READ" | "FAILED";
    sentAt: string;
    editedAt?: string;
    isEdited: boolean;
  }>;
  meta: PaginationMeta;
}
```

### Send Message to Thread
```http
POST /api/v1/messaging/threads/:threadId/messages
Authorization: Bearer <token>
```

**Path Parameters:**
- `threadId` (number): Thread ID

**Request Body:**
```typescript
{
  content: string;
  messageType?: string;          // Default: "TEXT"
  priority?: string;             // Default: "MEDIUM"
  mentions?: Array<number>;      // User IDs to mention
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
  }>;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Message sent successfully";
  data: Message;
}
```

### Archive Message Thread
```http
PUT /api/v1/messaging/threads/:threadId/archive
Authorization: Bearer <token>
```

**Path Parameters:**
- `threadId` (number): Thread ID

**Response (200):**
```typescript
{
  success: true;
  message: "Thread archived successfully";
  data: {
    threadId: number;
    status: "ARCHIVED";
    archivedAt: string;
  };
}
```

### Unarchive Message Thread
```http
PUT /api/v1/messaging/threads/:threadId/unarchive
Authorization: Bearer <token>
```

**Path Parameters:**
- `threadId` (number): Thread ID

**Response (200):**
```typescript
{
  success: true;
  message: "Thread unarchived successfully";
  data: {
    threadId: number;
    status: "ACTIVE";
    unarchivedAt: string;
  };
}
```

### Get Cross-Role Communication Rules
```http
GET /api/v1/messaging/communication-rules
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    availableRoles: Array<{
      role: string;
      userCount: number;
      canReceiveMessages: boolean;
      canSendBroadcast: boolean;
    }>;
    communicationMatrix: Array<{
      fromRole: string;
      toRole: string;
      allowed: boolean;
      requiresApproval: boolean;
      restrictions: Array<string>;
    }>;
    broadcastCapabilities: Array<{
      role: string;
      canBroadcastTo: Array<string>;
      maxRecipients: number;
      requiresApproval: boolean;
    }>;
  };
}
```

### Get Notification Preferences
```http
GET /api/v1/messaging/preferences
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    userId: number;
    emailNotifications: boolean;
    pushNotifications: boolean;
    smsNotifications: boolean;
    priority: {
      low: boolean;
      medium: boolean;
      high: boolean;
      urgent: boolean;
    };
    categories: {
      general: boolean;
      academic: boolean;
      disciplinary: boolean;
      financial: boolean;
      administrative: boolean;
      emergency: boolean;
    };
    quietHours: {
      enabled: boolean;
      startTime: string;
      endTime: string;
    };
    digestFrequency: "IMMEDIATE" | "HOURLY" | "DAILY" | "WEEKLY" | "DISABLED";
  };
}
```

### Update Notification Preferences
```http
PUT /api/v1/messaging/preferences
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  smsNotifications?: boolean;
  priority?: {
    low?: boolean;
    medium?: boolean;
    high?: boolean;
    urgent?: boolean;
  };
  categories?: {
    general?: boolean;
    academic?: boolean;
    disciplinary?: boolean;
    financial?: boolean;
    administrative?: boolean;
    emergency?: boolean;
  };
  quietHours?: {
    enabled?: boolean;
    startTime?: string;
    endTime?: string;
  };
  digestFrequency?: "IMMEDIATE" | "HOURLY" | "DAILY" | "WEEKLY" | "DISABLED";
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Notification preferences updated successfully";
  data: NotificationPreferences;
}
```

### Mark Messages as Read
```http
POST /api/v1/messaging/mark-read
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  messageIds: Array<number>;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "X messages marked as read";
  data: {
    success: boolean;
    markedCount: number;
  };
}
```

### Search Messages
```http
GET /api/v1/messaging/search
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  q: string;             // Search query (minimum 3 characters)
  category?: string;
  priority?: string;
  dateFrom?: string;     // "YYYY-MM-DD"
  dateTo?: string;       // "YYYY-MM-DD"
  senderId?: number;
  page?: number;         // Default: 1
  limit?: number;        // Default: 20
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    threadId: number;
    threadSubject: string;
    content: string;
    senderName: string;
    sentAt: string;
    category: string;
    priority: string;
    relevanceScore: number;
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    query: string;
    filters: object;
  };
}
```

### Get Message Statistics
```http
GET /api/v1/messaging/statistics
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalThreads: number;
    totalMessages: number;
    unreadMessages: number;
    sentMessages: number;
    receivedMessages: number;
    averageResponseTime: string;
    mostActiveCategory: string;
    messagesByCategory: object;
    messagesByPriority: object;
    weeklyActivity: Array<{
      day: string;
      sent: number;
      received: number;
    }>;
  };
}
```

### Add Message Reaction
```http
POST /api/v1/messaging/messages/:messageId/reactions
Authorization: Bearer <token>
```

**Path Parameters:**
- `messageId` (number): Message ID

**Request Body:**
```typescript
{
  reaction: "👍" | "👎" | "❤️" | "😂" | "😮" | "😢" | "😡";
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Reaction added successfully";
  data: {
    messageId: number;
    userId: number;
    reaction: string;
    reactedAt: string;
  };
}
```

### Remove Message Reaction
```http
DELETE /api/v1/messaging/messages/:messageId/reactions
Authorization: Bearer <token>
```

**Path Parameters:**
- `messageId` (number): Message ID

**Request Body:**
```typescript
{
  reaction: string;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Reaction removed successfully";
  data: {
    messageId: number;
    userId: number;
    reaction: string;
    removedAt: string;
  };
}
```

---

## Enhanced Manager Operations

### Get Manager Dashboard
```http
GET /api/v1/manager/dashboard
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStaff: number;
    totalStudents: number;
    totalParents: number;
    activeClasses: number;
    pendingTasks: number;
    todaysSchedule: Array<{
      id: number;
      time: string;
      activity: string;
      location: string;
      attendees: Array<string>;
      status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    }>;
    operationalMetrics: {
      attendanceRate: number;
      disciplineIssues: number;
      feeCollection: number;
      maintenanceRequests: number;
    };
    staffOverview: {
      present: number;
      absent: number;
      onLeave: number;
      newRequests: number;
    };
    recentActivities: Array<{
      id: number;
      activity: string;
      user: string;
      timestamp: string;
      category: "ACADEMIC" | "ADMINISTRATIVE" | "OPERATIONAL" | "FINANCIAL";
      priority: "LOW" | "MEDIUM" | "HIGH";
    }>;
    alerts: Array<{
      id: number;
      type: "WARNING" | "INFO" | "URGENT";
      message: string;
      timestamp: string;
      actionRequired: boolean;
    }>;
  };
}
```

### Get Staff Management Overview
```http
GET /api/v1/manager/staff-management
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStaff: number;
    staffByRole: Array<{
      role: string;
      count: number;
      present: number;
      absent: number;
    }>;
    attendanceOverview: {
      presentToday: number;
      absentToday: number;
      onLeaveToday: number;
      attendanceRate: number;
    };
    leaveRequests: {
      pending: number;
      approved: number;
      rejected: number;
      total: number;
    };
    staffPerformance: Array<{
      staffId: number;
      staffName: string;
      role: string;
      department: string;
      performanceScore: number;
      attendanceRate: number;
      punctualityScore: number;
      tasksCompleted: number;
      feedback: string;
    }>;
    upcomingLeaves: Array<{
      staffId: number;
      staffName: string;
      leaveType: string;
      startDate: string;
      endDate: string;
      status: string;
    }>;
  };
}
```

### Get Operational Support Overview
```http
GET /api/v1/manager/operational-support
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    maintenanceRequests: {
      total: number;
      pending: number;
      inProgress: number;
      completed: number;
      urgent: number;
    };
    facilityStatus: Array<{
      facility: string;
      status: "OPERATIONAL" | "MAINTENANCE" | "OUT_OF_ORDER";
      lastChecked: string;
      nextMaintenance: string;
      urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    }>;
    inventoryAlerts: Array<{
      item: string;
      currentStock: number;
      minimumRequired: number;
      status: "LOW_STOCK" | "OUT_OF_STOCK" | "REORDER_NEEDED";
      supplier: string;
      lastOrdered: string;
    }>;
    transportManagement: {
      totalVehicles: number;
      operational: number;
      maintenance: number;
      routesActive: number;
      studentsTransported: number;
    };
    securityOverview: {
      incidentsToday: number;
      visitorsRegistered: number;
      securityAlerts: number;
      accessControlStatus: "NORMAL" | "ALERT" | "LOCKDOWN";
    };
  };
}
```

### Get Administrative Support Overview
```http
GET /api/v1/manager/administrative-support
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    documentManagement: {
      pendingApprovals: number;
      expiringSoon: number;
      renewalsNeeded: number;
      totalDocuments: number;
    };
    communicationSummary: {
      noticesSent: number;
      messagesUnread: number;
      urgentCommunications: number;
      broadcastsScheduled: number;
    };
    eventCoordination: {
      upcomingEvents: number;
      eventsThisWeek: number;
      pendingApprovals: number;
      resourcesNeeded: number;
    };
    complianceTracking: {
      regulatoryCompliance: number;
      pendingAudits: number;
      policiesUpdated: number;
      trainingRequired: number;
    };
  };
}
```

### Generate Operational Report
```http
GET /api/v1/manager/reports/operational
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  period?: string;           // "weekly" | "monthly" | "quarterly" | "yearly"
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    generatedAt: string;
    period: string;
    summary: {
      totalStaff: number;
      totalStudents: number;
      attendanceRate: number;
      disciplineIncidents: number;
      academicPerformance: number;
    };
    keyMetrics: Array<{
      metric: string;
      value: number | string;
      trend: "IMPROVING" | "DECLINING" | "STABLE";
      comparison: string;
    }>;
    recommendations: Array<string>;
  };
}
```

### Process Maintenance Request
```http
PUT /api/v1/manager/maintenance-requests/:requestId
Authorization: Bearer <token>
```

**Path Parameters:**
- `requestId` (number): Maintenance request ID

**Request Body:**
```typescript
{
  action: "APPROVE" | "REJECT" | "ASSIGN";
  assignedTo?: string;
  priority?: string;
  notes?: string;
  estimatedCompletion?: string;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Maintenance request [action] successfully";
  data: {
    requestId: number;
    action: string;
    processedAt: string;
    assignedTo?: string;
    priority?: string;
    notes?: string;
    estimatedCompletion?: string;
  };
}
```

### Update Facility Status
```http
PUT /api/v1/manager/facilities/:facilityId/status
Authorization: Bearer <token>
```

**Path Parameters:**
- `facilityId` (number): Facility ID

**Request Body:**
```typescript
{
  status: "OPERATIONAL" | "MAINTENANCE" | "OUT_OF_ORDER";
  notes?: string;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Facility status updated successfully";
  data: {
    facilityId: number;
    status: string;
    updatedAt: string;
    notes?: string;
  };
}
```

### Process Leave Request
```http
PUT /api/v1/manager/leave-requests/:requestId
Authorization: Bearer <token>
```

**Path Parameters:**
- `requestId` (number): Leave request ID

**Request Body:**
```typescript
{
  action: "APPROVE" | "REJECT";
  notes?: string;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Leave request [action] successfully";
  data: {
    requestId: number;
    action: string;
    processedAt: string;
    processorNotes?: string;
  };
}
```

### Create Task Assignment
```http
POST /api/v1/manager/tasks
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  title: string;
  description: string;
  assignedTo: Array<number>;    // User IDs
  priority?: string;            // "LOW" | "MEDIUM" | "HIGH" | "URGENT", default: "MEDIUM"
  dueDate: string;              // "YYYY-MM-DD"
  category?: string;            // "GENERAL" | "ADMINISTRATIVE" | "MAINTENANCE" | "ACADEMIC"
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Task assigned successfully";
  data: {
    id: number;
    title: string;
    description: string;
    assignedTo: Array<number>;
    priority: string;
    dueDate: string;
    category: string;
    status: "PENDING";
    createdAt: string;
    createdBy: string;
  };
}
```

### Get Staff Attendance Summary
```http
GET /api/v1/manager/staff-attendance
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  startDate?: string;        // "YYYY-MM-DD"
  endDate?: string;          // "YYYY-MM-DD"
  departmentId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    period: {
      startDate: string;
      endDate: string;
    };
    summary: {
      totalStaff: number;
      averageAttendance: number;
      totalAbsences: number;
      punctualityRate: number;
    };
    byDepartment: Array<{
      department: string;
      attendance: number;
      staff: number;
    }>;
    trends: {
      thisWeek: number;
      lastWeek: number;
      trend: "IMPROVING" | "DECLINING" | "STABLE";
    };
    topPerformers: Array<{
      name: string;
      attendance: number;
      department: string;
    }>;
  };
}
```

### Get Facility Maintenance Schedule
```http
GET /api/v1/manager/maintenance-schedule
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  facilityType?: string;
  status?: string;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    upcomingMaintenance: Array<{
      id: number;
      facility: string;
      type: string;
      scheduledDate: string;
      assignedTeam: string;
      priority: string;
      estimatedDuration: string;
    }>;
    overdueMaintenance: Array<{
      id: number;
      facility: string;
      type: string;
      originalDate: string;
      daysPastDue: number;
      priority: string;
    }>;
    maintenanceHistory: Array<{
      facility: string;
      completedDate: string;
      type: string;
      cost: number;
      technician: string;
    }>;
    totalFacilities: number;
    needingMaintenance: number;
    maintenanceCompliance: number;
  };
}
```

### Get Inventory Status
```http
GET /api/v1/manager/inventory
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  category?: string;
  alertsOnly?: boolean;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    overview: {
      totalItems: number;
      lowStock: number;
      outOfStock: number;
      wellStocked: number;
    };
    categories: Array<{
      category: string;
      totalItems: number;
      alerts: number;
      value: number;
    }>;
    criticalItems: Array<{
      item: string;
      currentStock: number;
      minimumRequired: number;
      status: "OUT_OF_STOCK" | "LOW_STOCK";
      lastOrdered: string;
      supplier: string;
    }>;
    reorderSuggestions: Array<{
      item: string;
      suggestedQuantity: number;
      estimatedCost: number;
      urgency: "LOW" | "MEDIUM" | "HIGH";
    }>;
  };
}
```

---

## Discipline Master Enhanced (Behavioral Management)

### Get Discipline Master Enhanced Dashboard
```http
GET /api/v1/discipline-master/dashboard
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalActiveIssues: number;
    resolvedThisWeek: number;
    pendingResolution: number;
    studentsWithMultipleIssues: number;
    averageResolutionTime: number;
    attendanceRate: number;
    latenessIncidents: number;
    absenteeismCases: number;
    interventionSuccess: number;
    criticalCases: number;
    behavioralTrends: {
      thisMonth: number;
      lastMonth: number;
      trend: "IMPROVING" | "DECLINING" | "STABLE";
    };
    urgentInterventions: Array<{
      studentId: number;
      studentName: string;
      issueCount: number;
      riskLevel: "HIGH" | "MEDIUM" | "LOW";
      lastIncident: string;
      recommendedAction: string;
    }>;
    issuesByType: Array<{
      type: string;
      count: number;
      trend: "INCREASING" | "DECREASING" | "STABLE";
      resolution_rate: number;
    }>;
  };
}
```

### Get Behavioral Analytics
```http
GET /api/v1/discipline-master/behavioral-analytics
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStudents: number;
    studentsWithIssues: number;
    behaviorScore: number;
    riskDistribution: {
      high: number;
      medium: number;
      low: number;
      none: number;
    };
    monthlyTrends: Array<{
      month: string;
      incidents: number;
      resolved: number;
      newCases: number;
    }>;
    issueTypeAnalysis: Array<{
      issueType: string;
      frequency: number;
      averageResolutionTime: number;
      recurrenceRate: number;
      effectiveInterventions: Array<string>;
    }>;
    classroomHotspots: Array<{
      subClassName: string;
      className: string;
      incidentCount: number;
      riskScore: number;
      primaryIssues: Array<string>;
    }>;
  };
}
```

### Get Student Behavior Profile
```http
GET /api/v1/discipline-master/student-profile/:studentId
Authorization: Bearer <token>
```

**Path Parameters:**
- `studentId` (number): Student ID

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    studentId: number;
    studentName: string;
    matricule: string;
    className: string;
    subClassName: string;
    riskLevel: "HIGH" | "MEDIUM" | "LOW" | "NONE";
    behaviorScore: number;
    totalIncidents: number;
    recentIncidents: number;
    interventionsReceived: number;
    lastIncidentDate?: string;
    behaviorPattern: {
      mostCommonIssues: Array<string>;
      triggerFactors: Array<string>;
      improvementAreas: Array<string>;
      strengths: Array<string>;
    };
    interventionHistory: Array<{
      id: number;
      type: string;
      date: string;
      description: string;
      outcome: "SUCCESSFUL" | "PARTIALLY_SUCCESSFUL" | "UNSUCCESSFUL" | "ONGOING";
      followUpDate?: string;
    }>;
    recommendedActions: Array<{
      priority: "HIGH" | "MEDIUM" | "LOW";
      action: string;
      timeline: string;
      responsible: string;
    }>;
  };
}
```

### Get Early Warning System
```http
GET /api/v1/discipline-master/early-warning
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    criticalStudents: Array<{
      studentId: number;
      studentName: string;
      warningLevel: "CRITICAL" | "HIGH" | "MODERATE";
      riskFactors: Array<string>;
      triggerEvents: Array<string>;
      recommendedActions: Array<string>;
      urgency: "IMMEDIATE" | "WITHIN_WEEK" | "MONITOR";
    }>;
    riskIndicators: Array<{
      indicator: string;
      studentsAffected: number;
      severity: "HIGH" | "MEDIUM" | "LOW";
      trendDirection: "INCREASING" | "STABLE" | "DECREASING";
    }>;
    preventiveRecommendations: Array<{
      category: string;
      recommendation: string;
      targetStudents: number;
      priority: "HIGH" | "MEDIUM" | "LOW";
      implementationTimeline: string;
    }>;
  };
}
```

### Get Discipline Statistics
```http
GET /api/v1/discipline-master/statistics
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  startDate?: string;    // "YYYY-MM-DD"
  endDate?: string;      // "YYYY-MM-DD"
  classId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    overview: {
      totalStudents: number;
      studentsWithIssues: number;
      behaviorScore: number;
      riskDistribution: object;
    };
    trends: Array<object>;
    issueAnalysis: Array<object>;
    classroomHotspots: Array<object>;
    filters: {
      academicYearId?: number;
      startDate?: string;
      endDate?: string;
      classId?: number;
    };
  };
}
```

### Get Intervention Tracking
```http
GET /api/v1/discipline-master/interventions
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  status?: "PLANNED" | "ONGOING" | "COMPLETED" | "CANCELLED";
  studentId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    studentId: number;
    studentName: string;
    interventionType: string;
    description: string;
    startDate: string;
    expectedEndDate?: string;
    actualEndDate?: string;
    status: "PLANNED" | "ONGOING" | "COMPLETED" | "CANCELLED";
    outcome?: "SUCCESSFUL" | "PARTIALLY_SUCCESSFUL" | "UNSUCCESSFUL";
    effectiveness: number;
    followUpRequired: boolean;
    nextReviewDate?: string;
    assignedTo: string;
    notes: Array<{
      date: string;
      note: string;
      recordedBy: string;
    }>;
  }>;
  meta: {
    total: number;
    filters: object;
  };
}
```

### Create Intervention Plan
```http
POST /api/v1/discipline-master/interventions
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  studentId: number;
  interventionType: string;
  description: string;
  expectedEndDate?: string;  // "YYYY-MM-DD"
  assignedTo: string;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Intervention plan created successfully";
  data: {
    id: number;
    studentId: number;
    interventionType: string;
    description: string;
    startDate: string;
    expectedEndDate?: string;
    status: "PLANNED";
    assignedTo: string;
    createdAt: string;
    createdBy: string;
  };
}
```

### Update Intervention Status
```http
PUT /api/v1/discipline-master/interventions/:interventionId
Authorization: Bearer <token>
```

**Path Parameters:**
- `interventionId` (number): Intervention ID

**Request Body:**
```typescript
{
  status: "PLANNED" | "ONGOING" | "COMPLETED" | "CANCELLED";
  outcome?: "SUCCESSFUL" | "PARTIALLY_SUCCESSFUL" | "UNSUCCESSFUL";
  notes?: string;
  effectiveness?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Intervention updated successfully";
  data: {
    id: number;
    status: string;
    outcome?: string;
    effectiveness?: number;
    updatedAt: string;
    updatedBy: string;
  };
}
```

### Get Risk Assessment
```http
GET /api/v1/discipline-master/risk-assessment
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  riskLevel?: "CRITICAL" | "HIGH" | "MODERATE";
  classId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStudentsAssessed: number;
    riskLevelBreakdown: {
      critical: number;
      high: number;
      moderate: number;
    };
    studentsAtRisk: Array<object>;
    riskIndicators: Array<object>;
    recommendations: Array<object>;
    filters: object;
  };
}
```

### Generate Discipline Report
```http
GET /api/v1/discipline-master/reports
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  reportType?: string;      // Default: "comprehensive"
  startDate?: string;       // "YYYY-MM-DD"
  endDate?: string;         // "YYYY-MM-DD"
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    reportInfo: {
      type: string;
      generatedAt: string;
      generatedBy: string;
      academicYearId?: number;
      dateRange: {
        startDate?: string;
        endDate?: string;
      };
    };
    executiveSummary: {
      totalActiveIssues: number;
      studentsWithIssues: number;
      behaviorScore: number;
      criticalCases: number;
      resolutionRate: number;
    };
    detailedAnalysis: {
      dashboard: object;
      behavioralAnalytics: object;
      earlyWarning: object;
    };
    recommendations: Array<string>;
    actionItems: Array<{
      priority: "HIGH" | "MEDIUM" | "LOW";
      action: string;
      responsible: string;
      deadline: string;
    }>;
  };
}
```

---

## Teacher Portal

### Get My Subjects
```http
GET /api/v1/teachers/me/subjects
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    code: string;
    category: string;
    coefficient: number;
    // ... other subject details
    subclasses: Array<{
      id: number;
      name: string;
      className: string;
      studentCount: number;
    }>;
  }>;
}
```

### Get My Students
```http
GET /api/v1/teachers/me/students
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  subClassId?: number;
  subjectId?: number;
  academicYearId?: number;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}
```

### Get My Subclasses
```http
GET /api/v1/teachers/me/subclasses
Authorization: Bearer <token>
```

### Get My Dashboard
```http
GET /api/v1/teachers/me/dashboard
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    subjectsTeaching: number;
    totalStudentsTeaching: number;
    marksToEnter: number;
    classesTaught: number;
    upcomingPeriods: number;
    weeklyHours: number;
    attendanceRate: number;
    totalHoursPerWeek: number;
  };
}
```

### Check My Access
```http
GET /api/v1/teachers/me/access-check
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  subjectId?: number;
  subClassId?: number;
  academicYearId?: number;
}
```

### Get My Subject IDs
```http
GET /api/v1/teachers/me/subject-ids
Authorization: Bearer <token>
```

### Get My Subclass IDs
```http
GET /api/v1/teachers/me/subclass-ids
Authorization: Bearer <token>
```

### Get Current and Next Subjects from Timetable
```http
GET /api/v1/teachers/me/timetable/current-next
Authorization: Bearer <token>
```

**Description:**
Returns the teacher's current subject (if any) and next subject based on the current time and timetable. Useful for real-time display of what the teacher is teaching now and what's coming up next.

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional, defaults to current academic year
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    current: {
      period: {
        id: number;
        name: string;           // "Period 1"
        startTime: string;      // "08:00"
        endTime: string;        // "08:55"
        dayOfWeek: string;      // "MONDAY"
      };
      subject: {
        id: number;
        name: string;           // "Mathematics"
        category: string;       // "SCIENCE"
      };
      subClass: {
        id: number;
        name: string;           // "Form 1A"
        className: string;      // "Form 1"
      };
      isActive: boolean;        // true if currently in this period
      minutesRemaining: number; // Minutes left in current period
    } | null;
    next: {
      period: {
        id: number;
        name: string;           // "Period 2"
        startTime: string;      // "09:00"
        endTime: string;        // "09:55"
        dayOfWeek: string;      // "MONDAY"
      };
      subject: {
        id: number;
        name: string;           // "Physics"
        category: string;       // "SCIENCE"
      };
      subClass: {
        id: number;
        name: string;           // "Form 2A"
        className: string;      // "Form 2"
      };
      minutesToStart: number;   // Minutes until this period starts
      isToday: boolean;         // true if this is today's schedule
    } | null;
    requestTime: string;        // ISO timestamp of request
    currentDay: string;         // "MONDAY", "TUESDAY", etc.
  };
}
```

**Error Responses:**
- `401`: User not authenticated
- `500`: Server error (e.g., "No active academic year found")

### Get My Attendance Records (NEW - Teacher Attendance Management)
```http
GET /api/v1/teachers/me/attendance
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  startDate?: string;    // "YYYY-MM-DD"
  endDate?: string;      // "YYYY-MM-DD"
  academicYearId?: number;
  page?: number;
  limit?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    date: string;
    status: "PRESENT" | "ABSENT" | "LATE" | "SICK_LEAVE" | "AUTHORIZED_LEAVE";
    reason?: string;
    periodId?: number;
    periodName?: string;
    recordedBy: string;
    createdAt: string;
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

### Record Student Attendance (NEW - Teacher Attendance Management)
```http
POST /api/v1/teachers/attendance/record
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  studentId: number;
  subClassId: number;
  subjectId: number;
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
  reason?: string;
  periodId?: number;
  date?: string;         // "YYYY-MM-DD", defaults to today
  academicYearId?: number;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Student attendance recorded successfully";
  data: {
    id: number;
    studentId: number;
    studentName: string;
    studentMatricule: string;
    date: string;
    status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
    reason?: string;
    periodId?: number;
    periodName?: string;
    subClassName: string;
    subjectName: string;
  };
}
```

### Get Attendance Statistics (NEW - Teacher Attendance Management)
```http
GET /api/v1/teachers/attendance/statistics
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  subClassId?: number;
  subjectId?: number;
  startDate?: string;    // "YYYY-MM-DD"
  endDate?: string;      // "YYYY-MM-DD"
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStudents: number;
    presentToday: number;
    absentToday: number;
    lateToday: number;
    attendanceRate: number;
    weeklyTrends: Array<{
      date: string;
      presentCount: number;
      absentCount: number;
      lateCount: number;
      attendanceRate: number;
    }>;
    subClassBreakdown: Array<{
      subClassId: number;
      subClassName: string;
      totalStudents: number;
      attendanceRate: number;
      absentStudents: number;
    }>;
  };
}
```

### Get SubClass Attendance (NEW - Teacher Attendance Management)
```http
GET /api/v1/teachers/attendance/subclass/:id
Authorization: Bearer <token>
```

**Path Parameters:**
- `id` (number): SubClass ID

**Query Parameters:**
```typescript
{
  date?: string;         // "YYYY-MM-DD" - specific date filter
  subjectId?: number;
  academicYearId?: number;
  page?: number;
  limit?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    studentId: number;
    studentName: string;
    studentMatricule: string;
    date: string;
    status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
    reason?: string;
    periodId?: number;
    periodName?: string;
    subClassName: string;
    subjectName: string;
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

---

## HOD (Head of Department)

### Get HOD Dashboard
```http
GET /api/v1/hod/dashboard
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalSubjects: number;
    totalTeachers: number;
    totalStudents: number;
    totalClasses: number;
    departmentAverage: number;
    overallPassRate: number;
    subjectsManaged: Array<{
      id: number;
      name: string;
      category: string;
    }>;
  };
}
```

### Get Department Overview
```http
GET /api/v1/hod/department-overview
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    subjectId: number;
    subjectName: string;
    subjectCategory: string;
    totalTeachers: number;
    totalStudents: number;
    totalClasses: number;
    averagePerformance: number;
    teachersAssigned: Array<{
      id: number;
      name: string;
      email: string;
      matricule: string;
      classesTeaching: number;
      studentsTeaching: number;
      averageMarks: number;
    }>;
  }>;
}
```

### Get Teachers in Department
```http
GET /api/v1/hod/teachers-in-department
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  search?: string;      // Search by name, email, or matricule
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    email: string;
    matricule: string;
    phone: string;
    totalHoursPerWeek: number;
    subjectsTeaching: Array<{
      id: number;
      name: string;
      classCount: number;
      studentCount: number;
      averageMarks: number;
    }>;
    classesTeaching: Array<{
      id: number;
      name: string;
      className: string;
      studentCount: number;
      averageMarks: number;
    }>;
    performanceMetrics: {
      totalStudents: number;
      averageMarks: number;
      passRate: number;
      excellentRate: number;
    };
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

### Get Subject Performance
```http
GET /api/v1/hod/subject-performance
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  subjectId?: number;   // Optional filter for specific subject
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    subjectId: number;
    subjectName: string;
    totalStudents: number;
    totalClasses: number;
    averageMarks: number;
    passRate: number;
    excellentRate: number;
    classBreakdown: Array<{
      subClassId: number;
      subClassName: string;
      className: string;
      studentCount: number;
      averageMarks: number;
      teacherName: string;
      teacherId: number;
    }>;
    performanceTrends: Array<{
      sequenceNumber: number;
      termName: string;
      averageMarks: number;
      passRate: number;
    }>;
  }>;
}
```

### Assign Teacher to Subject
```http
POST /api/v1/hod/assign-teacher-subject
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  subjectId: number;
  teacherId: number;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Teacher successfully assigned to subject";
  data: {
    id: number;
    subjectId: number;
    teacherId: number;
    teacher: {
      id: number;
      name: string;
      email: string;
      matricule: string;
    };
    subject: {
      id: number;
      name: string;
      category: string;
    };
    createdAt: string;
  };
}
```

### Get Department Analytics
```http
GET /api/v1/hod/department-analytics
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    subjectId: number;
    subjectName: string;
    totalTeachers: number;
    totalStudents: number;
    totalClasses: number;
    overallAverage: number;
    overallPassRate: number;
    topPerformingClass: {
      subClassName: string;
      averageMarks: number;
    } | null;
    lowestPerformingClass: {
      subClassName: string;
      averageMarks: number;
    } | null;
    teacherPerformanceRanking: Array<{
      teacherId: number;
      teacherName: string;
      averageMarks: number;
      studentsCount: number;
      classesCount: number;
    }>;
    monthlyTrends: Array<{
      month: string;
      averageMarks: number;
      studentsEvaluated: number;
    }>;
  }>;
}
```

### Get Teacher Performance
```http
GET /api/v1/hod/teacher-performance/:teacherId
Authorization: Bearer <token>
```

**Path Parameters:**
- `teacherId` (number): Teacher ID

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    teacher: {
      id: number;
      name: string;
      email: string;
      matricule: string;
    };
    overallPerformance: {
      totalMarks: number;
      averageScore: number;
      passRate: number;
      excellentRate: number;
    };
    subjectPerformance: Array<{
      subjectId: number;
      subjectName: string;
      totalMarks: number;
      averageScore: number;
      passRate: number;
    }>;
    classPerformance: Array<{
      subClassId: number;
      subClassName: string;
      className: string;
      totalMarks: number;
      averageScore: number;
      passRate: number;
    }>;
  };
}
```

### Get My Subjects
```http
GET /api/v1/hod/my-subjects
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    category: string;
    totalTeachers: number;
    totalClasses: number;
    totalStudents: number;
  }>;
}
```

---

## Timetable Management

### Get Subclass Timetable
```http
GET /api/v1/timetables/subclass/:subclassId
Authorization: Bearer <token>
```

**Description:**
Retrieves the timetable for a specific subclass for a given academic year.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `subclassId` (number): The ID of the subclass.

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year if not provided.
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    subClass: {
      id: number;
      name: string;
      class: {
        id: number;
        name: string;
      };
    };
    academicYearId: number;
    slots: Array<{
      id: number;
      subClassId: number;
      subClassName: string;
      classId: number;
      className: string;
      day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
      periodId: number;
      periodName: string;
      periodStartTime: string;
      periodEndTime: string;
      isBreak: boolean;
      subjectId: number | null;
      subjectName: string | null;
      subjectCategory: string | null;
      teacherId: number | null;
      teacherName: string | null;
    }>;
  };
}
```

### Get Full School Timetable
```http
GET /api/v1/timetables/full-school
Authorization: Bearer <token>
```

**Description:**
Retrieves the complete timetable for the entire school for a specific academic year.

**Authorization:**
- `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `MANAGER`, `DEAN_OF_STUDIES`

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year if not provided.
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    academicYearId: number;
    academicYearName: string;
    timetableSlots: Array<{
      id: number;
      subClassId: number;
      subClassName: string;
      classId: number;
      className: string;
      day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
      periodId: number;
      periodName: string;
      periodStartTime: string;
      periodEndTime: string;
      isBreak: boolean;
      subjectId: number | null;
      subjectName: string | null;
      subjectCategory: string | null;
      teacherId: number | null;
      teacherName: string | null;
    }>;
  };
}
```

### Download Subclass Timetable (PDF)
```http
GET /api/v1/timetables/subclass/:subclassId/export/pdf
Authorization: Bearer <token>
```

**Description:** Returns a landscape A4 PDF of the specified subclass timetable. Cells show `Subject` with the teacher name beneath. BREAK / PREP rows are shaded and labelled.

**Authorization:** Any authenticated user.

**Path Parameters:**
- `subclassId` (number)

**Query Parameters:**
- `academicYearId` (number, optional) — defaults to the current academic year.

**Response:** `Content-Type: application/pdf` — binary PDF stream. Response header includes `Content-Disposition: attachment; filename="timetable_<SubClassName>.pdf"`.

---

### Download Full-School Timetable (PDF)
```http
GET /api/v1/timetables/full-school/export/pdf
Authorization: Bearer <token>
```

**Description:** Returns a single PDF containing one page per subclass.

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `MANAGER`, `DEAN_OF_STUDIES`.

**Query Parameters:**
- `academicYearId` (number, optional).

**Response:** `Content-Type: application/pdf` — binary PDF stream.

---

### Download Teacher Timetable — Self (PDF)
```http
GET /api/v1/teachers/me/timetable/export/pdf
Authorization: Bearer <token>
```

**Description:** Returns a landscape A4 PDF of the currently authenticated teacher's weekly timetable. Cells show `Subject` with `Class / Sub-class` beneath. Summary chips at the top show class count, subject count, and weekly hours.

**Authorization:** `TEACHER`.

**Query Parameters:**
- `academicYearId` (number, optional).

**Response:** `Content-Type: application/pdf` — binary PDF stream.

---

### Download Teacher Timetable — Admin (PDF)
```http
GET /api/v1/timetables/teacher/:teacherId/export/pdf
Authorization: Bearer <token>
```

**Description:** Admin/leadership variant of the above — download any teacher's weekly timetable as a PDF.

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `MANAGER`, `DEAN_OF_STUDIES`.

**Path Parameters:**
- `teacherId` (number)

**Query Parameters:**
- `academicYearId` (number, optional).

**Response:** `Content-Type: application/pdf` — binary PDF stream.

---

### Bulk Update Timetable
```http
POST /api/v1/timetables/subclass/:subclassId/bulk-update
Authorization: Bearer <token>
```

**Description:**
Updates multiple timetable slots at once for a specific subclass. This allows for creating, updating, or deleting assignments for periods within a subclass for a given academic year.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `DEAN_OF_STUDIES`

**Path Parameters:**
- `subclassId` (number): The ID of the subclass for which to update the timetable.

**Request Body:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year if not provided.
  slots: Array<{
    periodId: number;         // Required: The ID of the period to update.
    subjectId: number | null; // Required: The ID of the subject to assign, or `null` to clear the subject.
    teacherId: number | null; // Required: The ID of the teacher to assign, or `null` to clear the teacher.
  }>;
}
```

**Response (200 - All Successful):**
```typescript
{
  success: true;
  message: "Timetable updated successfully." | "Timetable saved with warnings (teacher clashes detected).";
  data: {
    updated: number; // Number of existing slots updated.
    created: number; // Number of new slots created.
    deleted: number; // Number of slots deleted (where subjectId and teacherId were null).
  };
  errors: [];       // Empty array if no errors.
  warnings: Array<{
    periodId: number;
    type: "TEACHER_CLASH";
    message: string;
    clashWith: {
      subClassId: number;
      subClassName: string;
      day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
      periodName: string;
    };
  }>; // Slots that WERE SAVED but the teacher is double-booked elsewhere at that period.
}
```

**Note on teacher clashes:** A teacher already assigned to another subclass at the same period is no longer a hard failure. The slot **is saved** and a `TEACHER_CLASH` warning is added to `warnings[]`. The response stays `200`. Show these warnings in the UI so the scheduler can resolve the double-booking.

**Response (207 - Partial Success):**
```typescript
{
  success: false;
  message: "Partial success with errors." | "Saved with warnings and some slots failed.";
  data: {
    updated: number;
    created: number;
    deleted: number;
  };
  errors: Array<{
    periodId: number; // The ID of the period that had an error.
    error: string;    // Description of the error (missing IDs, teacher not authorized to teach subject, etc).
  }>;
  warnings: Array<{ periodId: number; type: "TEACHER_CLASH"; message: string; clashWith: {...} }>;
}
```

**Error Responses:**
- `400 Bad Request`:
  ```typescript
  {
    success: false;
    error: "subclassId and slots array are required" | "Invalid periodId format" | "Both subjectId and teacherId must be provided (or both null to clear)" | "Invalid subjectId or teacherId format" | "Teacher with ID X is not authorized to teach subject Y";
  }
  ```
- `401 Unauthorized`:
  ```typescript
  {
    success: false;
    error: "User not authenticated for assignment.";
  }
  ```
- `404 Not Found`:
  ```typescript
  {
    success: false;
    error: "No active academic year found for timetable update." | "Subclass not found" | "Period with ID X not found";
  }
  ```
- `500 Internal Server Error`:
  ```typescript
  {
    success: false;
    error: "Internal server error message";
  }
  ```
- `503 Service Unavailable`:
  ```typescript
  {
    success: false;
    error: "Database connection error. Please ensure the database is running and accessible.";
}
```

---

## Academic Year Management

Endpoints for creating, retrieving, updating, and managing academic years and their associated terms.

### Get All Academic Years
```http
GET /api/v1/academic-years
Authorization: Bearer <token>
```
**Description:**
Retrieves a list of all academic years in the system, including their terms and exam sequences.

**Authorization:**
- Any authenticated user.

**Response (200):**
```typescript
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "2024-2025",
      "startDate": "2024-09-01T00:00:00.000Z",
      "endDate": "2025-06-30T00:00:00.000Z",
      "isCurrent": true,
      "terms": [
        {
          "id": 1,
          "name": "Term 1",
          "startDate": "2024-09-01T00:00:00.000Z",
          "endDate": "2024-12-20T00:00:00.000Z",
          "feeDeadline": "2024-10-15T00:00:00.000Z"
        }
      ],
      "examSequences": []
    }
  ]
}
```

### Create Academic Year
```http
POST /api/v1/academic-years
Authorization: Bearer <token>
```
**Description:**
Creates a new academic year. If terms are not provided, it defaults to creating 'Term 1', 'Term 2', and 'Term 3'.

**Authorization:**
- `SUPER_MANAGER`

**Request Body:**
```typescript
{
  "name": "2025-2026",
  "startDate": "2025-09-01",
  "endDate": "2026-06-30",
  "terms": [
    {
      "name": "Term 1",
      "startDate": "2025-09-01",
      "endDate": "2025-12-19",
      "feeDeadline": "2025-10-15"
    },
    {
      // Holiday term example — no fee deadline, must list classIds
      "name": "Christmas Break (Form 1 & 2)",
      "startDate": "2025-12-20",
      "endDate": "2026-01-05",
      "isHoliday": true,
      "classIds": [1, 2]
    }
  ]
}
```

**Term fields:**
- `name` (string, required)
- `startDate` (ISO date, required)
- `endDate` (ISO date, required)
- `feeDeadline` (ISO date, optional — required for non-holiday terms if you want fee tracking)
- `isHoliday` (boolean, optional, default `false`) — marks the term as a holiday period
- `classIds` (number[], required when `isHoliday: true`) — the classes the holiday applies to

**Response (201):**
```typescript
{
  "success": true,
  "data": {
    "id": 2,
    "name": "2025-2026",
    "startDate": "2025-09-01T00:00:00.000Z",
    "endDate": "2026-06-30T00:00:00.000Z",
    "isCurrent": false,
    "terms": [
      {
        "id": 2,
        "name": "Term 1",
        "startDate": "2025-09-01T00:00:00.000Z",
        "endDate": "2025-12-19T00:00:00.000Z",
        "feeDeadline": "2025-10-15T00:00:00.000Z",
        "isHoliday": false,
        "termClasses": []
      },
      {
        "id": 3,
        "name": "Christmas Break (Form 1 & 2)",
        "startDate": "2025-12-20T00:00:00.000Z",
        "endDate": "2026-01-05T00:00:00.000Z",
        "feeDeadline": null,
        "isHoliday": true,
        "termClasses": [
          { "classId": 1 },
          { "classId": 2 }
        ]
      }
    ]
  }
}
```

**Error Response (400):**
```typescript
{
  "success": false,
  "error": "Holiday terms must specify at least one class in classIds"
}
```

### Get Current Academic Year
```http
GET /api/v1/academic-years/current
Authorization: Bearer <token>
```
**Description:**
Retrieves the academic year currently marked as `isCurrent: true`.

**Authorization:**
- Any authenticated user.

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "id": 1,
    "name": "2024-2025",
    "startDate": "2024-09-01T00:00:00.000Z",
    "endDate": "2025-06-30T00:00:00.000Z",
    "isCurrent": true,
    "terms": []
  }
}
```
**Error Response (404):**
```typescript
{
  "success": false,
  "error": "No current academic year found"
}
```

### Get Available Academic Years for Role
```http
GET /api/v1/academic-years/available-for-role
Authorization: Bearer <token>
```

**Description:**
Returns academic years where the authenticated user has the specified role assigned. For global roles (e.g., `SUPER_MANAGER`), it returns all academic years. This is primarily used in the login workflow after role selection.

**Authorization:**
- Any authenticated user.

**Query Parameters:**
```typescript
{
  "role": string; // Required. E.g., "PRINCIPAL", "TEACHER", "BURSAR"
}
```

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "academicYears": [
      {
        "id": 1,
        "name": "2024-2025",
        "startDate": "2024-09-01T00:00:00.000Z",
        "endDate": "2025-06-30T00:00:00.000Z",
        "isCurrent": true,
        "terms": [],
        "studentCount": 150,
        "classCount": 3,
        "status": "ACTIVE"
      }
    ],
    "currentAcademicYearId": 1,
    "userHasAccessTo": [1]
  }
}
```
**Error Response (400):**
```typescript
{
  "success": false,
  "error": "Role parameter is required"
}
```

### Get Academic Year by ID
```http
GET /api/v1/academic-years/:id
Authorization: Bearer <token>
```
**Description:**
Retrieves details for a specific academic year by its ID.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `id` (number): The ID of the academic year.

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "id": 1,
    "name": "2024-2025",
    "startDate": "2024-09-01T00:00:00.000Z",
    "endDate": "2025-06-30T00:00:00.000Z",
    "isCurrent": true,
    "terms": []
  }
}
```
**Error Response (404):**
```typescript
{
  "success": false,
  "error": "Academic year not found"
}
```

### Add a Term to an Academic Year
```http
POST /api/v1/academic-years/:id/terms
Authorization: Bearer <token>
```
**Description:**
Adds a new term to an existing academic year.

**Authorization:**
- `SUPER_MANAGER`

**Path Parameters:**
- `id` (number): The ID of the academic year.

**Request Body:**
```typescript
{
  "name": "Term 2",
  "startDate": "2025-01-06",
  "endDate": "2025-04-04",
  "feeDeadline": "2025-02-15",
  // Optional: add a holiday term instead of a teaching term
  "isHoliday": false,
  "classIds": [] // required when isHoliday === true
}
```

**Response (201):**
```typescript
{
  "success": true,
  "message": "Term \"Term 2\" added to academic year 2024-09-01T00:00:00.000Z",
  "data": {
    "id": 3,
    "name": "Term 2",
    "startDate": "2025-01-06T00:00:00.000Z",
    "endDate": "2025-04-04T00:00:00.000Z",
    "feeDeadline": "2025-02-15T00:00:00.000Z",
    "isHoliday": false,
    "academicYearId": 1,
    "termClasses": []
  }
}
```

### Get All Terms for an Academic Year
```http
GET /api/v1/academic-years/:id/terms
Authorization: Bearer <token>
```
**Description:**
Retrieves all terms associated with a specific academic year.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `id` (number): The ID of the academic year.

**Response (200):**
```typescript
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Term 1",
      "startDate": "2024-09-01T00:00:00.000Z",
      "endDate": "2024-12-20T00:00:00.000Z",
      "feeDeadline": "2024-10-15T00:00:00.000Z",
      "academicYearId": 1,
      "examSequences": []
    }
  ]
}
```

### Update an Academic Year
```http
PUT /api/v1/academic-years/:id
Authorization: Bearer <token>
```
**Description:**
Updates the details of an academic year.

**Authorization:**
- `SUPER_MANAGER`

**Path Parameters:**
- `id` (number): The ID of the academic year.

**Request Body:**
```typescript
{
  "startDate": "2024-09-02",
  "endDate": "2025-07-01"
}
```

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "id": 1,
    "name": "2024-2025",
    "startDate": "2024-09-02T00:00:00.000Z",
    "endDate": "2025-07-01T00:00:00.000Z",
    "isCurrent": true,
    "terms": []
  }
}
```

### Set an Academic Year as Current
```http
POST /api/v1/academic-years/:id/set-current
Authorization: Bearer <token>
```
**Description:**
Sets a specific academic year as the current one. This action will unset any other academic year that was previously current.

**Authorization:**
- `SUPER_MANAGER`

**Path Parameters:**
- `id` (number): The ID of the academic year to set as current.

**Response (200):**
```typescript
{
  "success": true,
  "message": "Academic year set as current successfully",
  "data": {
    "id": 1,
    "name": "2024-2025",
    "startDate": "2024-09-02T00:00:00.000Z",
    "endDate": "2025-07-01T00:00:00.000Z",
    "isCurrent": true,
    "terms": []
  }
}
```

### Delete an Academic Year
```http
DELETE /api/v1/academic-years/:id
Authorization: Bearer <token>
```
**Description:**
Deletes an academic year. This operation will fail if the academic year is referenced by other records like enrollments, exams, or user roles.

**Authorization:**
- `SUPER_MANAGER`

**Path Parameters:**
- `id` (number): The ID of the academic year to delete.

**Response (200):**
```typescript
{
  "success": true,
  "message": "Academic year deleted successfully"
}
```
**Error Response (409 - Conflict):**
```typescript
{
  "success": false,
  "error": "Cannot delete academic year. It is referenced by: 15 enrollment(s), 10 user role(s)"
}
```

---

## Student Management

### Get All Students
```http
GET /api/v1/students
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  enrollmentStatus?: "enrolled" | "not_enrolled" | "all";
  name?: string;           // Search by name
  matricule?: string;      // Search by matricule
  gender?: "MALE" | "FEMALE";
  subClassId?: number;
  page?: number;
  limit?: number;
  sortBy?: "name" | "matricule" | "dateOfBirth" | "createdAt";
  sortOrder?: "asc" | "desc";
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    matricule: string;
    name: string;
    dateOfBirth: string;
    placeOfBirth: string;
    gender: "MALE" | "FEMALE";
    residence: string;
    formerSchool?: string;
    isNewStudent: boolean;
    status: "NOT_ENROLLED" | "ENROLLED" | "ASSIGNED_TO_CLASS" | "GRADUATED" | "TRANSFERRED" | "SUSPENDED";
    enrollments: Array<{
      id: number;
      classId: number;
      subClassId?: number;
      academicYearId: number;
      repeater: boolean;
      photo?: string;
      subClass?: {
        id: number;
        name: string;
        class: {
          id: number;
          name: string;
        };
      };
    }>;
    parents: Array<{
      id: number;
      parent: {
        id: number;
        name: string;
        email: string;
        phone: string;
      };
    }>;
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

### Create Student
```http
POST /api/v1/students
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  matricule?: string;      // Auto-generated if not provided
  name?: string;
  nom?: string;
  prenom?: string;
  dateOfBirth: string;   // "YYYY-MM-DD"
  placeOfBirth: string;
  gender: "MALE" | "FEMALE";
  residence: string;
  formerSchool?: string;
  isNewStudent?: boolean; // Defaults to true
  status?: "NOT_ENROLLED" | "ENROLLED" | "ASSIGNED_TO_CLASS" | "GRADUATED" | "TRANSFERRED" | "SUSPENDED";
  // Discipline / profile extensions
  admissionAcademicYearId?: number;              // User-selectable admission year (any year)
  healthConditions?: Array<"SICKLE_CELL" | "ASTHMATIC" | "EPILEPTIC" | "DIABETIC" | "ALLERGY" | "HYPERTENSION" | "OTHER">;
  medicalNotes?: string;
  previousSchools?: Array<{
    schoolName: string;
    fromYear?: string;
    toYear?: string;
    notes?: string;
  }>;
}
```

### Get Student by ID
```http
GET /api/v1/students/:id
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

### Update Student
```http
PUT /api/v1/students/:id
Authorization: Bearer <token>
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `BURSAR`, `SECRETARY`

**Request Body (all fields optional — supports every field from Create Student):**
```typescript
{
  matricule?: string;                 // Must remain unique across students
  name?: string;                      // Auto-recomputed from nom + prenom when either changes
  nom?: string;                       // Family name (keeps `name` in sync with prenom)
  prenom?: string;                    // Given name (keeps `name` in sync with nom)
  dateOfBirth?: string;               // ISO date (e.g. "2010-05-14")
  placeOfBirth?: string;
  gender?: "Male" | "Female";
  residence?: string;
  formerSchool?: string;
  isNewStudent?: boolean;             // Triggers fee recalculation if changed
  status?: "NOT_ENROLLED" | "ENROLLED" | "ASSIGNED_TO_CLASS" | "GRADUATED" | "TRANSFERRED" | "SUSPENDED";
  // Ream-of-paper collection (stored on the student's Enrollment for the academic year)
  reamOfPaperCollected?: boolean;
  academicYearId?: number;            // Optional; targets which enrollment to update. Defaults to current academic year.
  // Discipline / profile extensions
  admissionAcademicYearId?: number;
  healthConditions?: Array<"SICKLE_CELL" | "ASTHMATIC" | "EPILEPTIC" | "DIABETIC" | "ALLERGY" | "HYPERTENSION" | "OTHER">;
  medicalNotes?: string;
  // NOTE: previous_schools are managed via /students/:id/previous-schools endpoints, not via Update Student.
}
```

**Notes:**
- `reamOfPaperCollected` updates the `Enrollment.ream_of_paper_collected` flag for the student's enrollment in the given (or current) academic year. The student must already be enrolled in that year — otherwise a 500 error is returned with message `No enrollment found for student <id> in academic year <yearId>...`.
- When `reamOfPaperCollected` is included, the response `data` will include an `enrollment` object reflecting the updated enrollment record alongside the updated student fields.

**Response (200):**
```typescript
{
  success: true,
  data: {
    // ...Student fields (id, name, matricule, ...)
    enrollment?: {
      id: number;
      studentId: number;
      academicYearId: number;
      classId: number;
      subClassId: number | null;
      reamOfPaperCollected: boolean;
      repeater: boolean;
      // ...
    }
  }
}
```

### Delete Student
```http
DELETE /api/v1/students/:id
Authorization: Bearer <token>
```

**Authorization:** `SUPER_MANAGER`, `BURSAR` — either role may delete any student.

Permanently removes the student and cascades through all related records (enrollments, marks, fees, payments, absences, discipline issues, parent links, generated reports, etc.).

**Responses:**
- `200`: `{ success: true, message: "Student deleted successfully" }`
- `404`: `{ success: false, error: "Student not found" }`
- `500`: `{ success: false, error: "Failed to delete student due to an internal error" }`

### Get Siblings
```http
GET /api/v1/students/:id/siblings
Authorization: Bearer <token>
```

Returns every other student who shares at least one parent with the given
student. Includes each sibling's current-year enrollment (if any) plus the
shared parent link(s).

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    student: Student;
    currentEnrollment: Enrollment | null;
    sharedParents: Array<{
      parent: { id: number; name: string; email: string; phone: string };
      siblingRelationship: "FATHER" | "MOTHER" | "SIBLING" | "GUARDIAN" | null;
      targetRelationship: "FATHER" | "MOTHER" | "SIBLING" | "GUARDIAN" | null;
    }>
  }>
}
```

### List Previous Schools
```http
GET /api/v1/students/:id/previous-schools
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    studentId: number;
    schoolName: string;
    fromYear: string | null;
    toYear: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  }>
}
```

### Add Previous School
```http
POST /api/v1/students/:id/previous-schools
Authorization: Bearer <token>
```

**Body:**
```typescript
{
  schoolName: string;
  fromYear?: string;
  toYear?: string;
  notes?: string;
}
```

### Update Previous School
```http
PUT /api/v1/students/:id/previous-schools/:psId
Authorization: Bearer <token>
```

Body (all optional): same fields as Add.

### Delete Previous School
```http
DELETE /api/v1/students/:id/previous-schools/:psId
Authorization: Bearer <token>
```

### Enroll Student
```http
POST /api/v1/students/:id/enroll
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  subClassId: number;
  academicYearId?: number;
  photo?: string;
  repeater?: boolean;             // Defaults to false
  reamOfPaperCollected?: boolean; // Optional, used for new students
}
```

### Link Parent
```http
POST /api/v1/students/:id/link-parent
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  parentId: number;
}
```

### Unlink Parent
```http
DELETE /api/v1/students/:studentId/parents/:parentId
Authorization: Bearer <token>
```

### Get Students by Subclass
```http
GET /api/v1/students/subclass/:subClassId
Authorization: Bearer <token>
```

### Get Students by Parent
```http
GET /api/v1/students/parent/:parentId
Authorization: Bearer <token>
```

### Get Parents by Student
```http
GET /api/v1/students/:studentId/parents
Authorization: Bearer <token>
```

### Search Students
```http
GET /api/v1/students/search
Authorization: Bearer <token>
```

**Description:**
Searches for students by their name or matricule, with optional filtering by academic year and pagination.

**Authorization:**
- Any authenticated user.

**Query Parameters:**
```typescript
{
  q: string;             // Required: Search query (student name or matricule, minimum 1 character)
  academicYearId?: number; // Optional: Filter by academic year
  page?: number;         // Optional: Page number for pagination (default: 1)
  limit?: number;        // Optional: Number of items per page (default: 10)
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    data: Array<{
      id: number;
      matricule: string;
      name: string;
      dateOfBirth: string;
      placeOfBirth: string;
      gender: "MALE" | "FEMALE";
      residence: string;
      formerSchool?: string;
      isNewStudent: boolean;
      status: "NOT_ENROLLED" | "ENROLLED" | "ASSIGNED_TO_CLASS" | "GRADUATED" | "TRANSFERRED" | "SUSPENDED";
      enrollments: Array<{
        id: number;
        classId: number;
        subClassId?: number;
        academicYearId: number;
        repeater: boolean;
        photo?: string;
        subClass?: {
          id: number;
          name: string;
          class: {
            id: number;
            name: string;
          };
        };
      }>;
      parents: Array<{
        id: number;
        parent: {
          id: number;
          name: string;
          email: string;
          phone: string;
        };
      }>;
    }>;
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  };
}
```

**Error Responses:**
```typescript
{
  success: false;
  error: "Search query is required and must be at least 1 character"
}
```

### Enroll Student
```http
POST /api/v1/students/:id/enroll
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  subClassId: number;
  academicYearId?: number;
  photo?: string;
  repeater?: boolean;      // Defaults to false
}
```

### Assign Student to Subclass
```http
POST /api/v1/students/:id/assign-subclass
Authorization: Bearer <token>
```

**Description:**
Assigns a student to a subclass. The student must have an existing enrollment in the specified academic year and not currently be assigned to a subclass.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `BURSAR`

**Path Parameters:**
- `id` (number): The ID of the student.

**Request Body:**
```typescript
{
  subClassId: number;   // Required: The ID of the subclass to assign.
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year.
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Student successfully assigned to subclass.";
  data: {
    id: number;
    studentId: number;
    classId: number;
    subClassId: number;
    academicYearId: number;
    repeater: boolean;
    enrollmentDate: string;
    createdAt: string;
    updatedAt: string;
    // ... other updated enrollment details
  };
}
```

**Error Responses:**
- `400`: `Invalid Student ID format` or `Invalid Subclass ID format` or `Invalid Academic Year ID format`
- `404`: `Student with ID X is not enrolled in academic year Y.` or `Subclass with ID X not found.`
- `409`: `Student with ID X is already assigned to a subclass (Subclass Name/ID) for academic year Y.`
- `500`: `Error assigning student to subclass: [error message]`

### Link Parent
```http
POST /api/v1/students/:id/link-parent
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  parentId: number;
}
```

### Unlink Parent
```http
DELETE /api/v1/students/:studentId/parents/:parentId
Authorization: Bearer <token>
```

### Get Students by Subclass
```http
GET /api/v1/students/subclass/:subClassId
Authorization: Bearer <token>
```

### Get Students by Parent
```http
GET /api/v1/students/parent/:parentId
Authorization: Bearer <token>
```

### Get Parents by Student
```http
GET /api/v1/students/:studentId/parents
Authorization: Bearer <token>
```

### Search Students
```http
GET /api/v1/students/search
Authorization: Bearer <token>
```

**Description:**
Searches for students by their name or matricule, with optional filtering by academic year and pagination.

**Authorization:**
- Any authenticated user.

**Query Parameters:**
```typescript
{
  q: string;             // Required: Search query (student name or matricule, minimum 1 character)
  academicYearId?: number; // Optional: Filter by academic year
  page?: number;         // Optional: Page number for pagination (default: 1)
  limit?: number;        // Optional: Number of items per page (default: 10)
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    data: Array<{
      id: number;
      matricule: string;
      name: string;
      dateOfBirth: string;
      placeOfBirth: string;
      gender: "MALE" | "FEMALE";
      residence: string;
      formerSchool?: string;
      isNewStudent: boolean;
      status: "NOT_ENROLLED" | "ENROLLED" | "ASSIGNED_TO_CLASS" | "GRADUATED" | "TRANSFERRED" | "SUSPENDED";
      enrollments: Array<{
        id: number;
        classId: number;
        subClassId?: number;
        academicYearId: number;
        repeater: boolean;
        photo?: string;
        subClass?: {
          id: number;
          name: string;
          class: {
            id: number;
            name: string;
          };
        };
      }>;
      parents: Array<{
        id: number;
        parent: {
          id: number;
          name: string;
          email: string;
          phone: string;
        };
      }>;
    }>;
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  };
}
```

**Error Responses:**
```typescript
{
  success: false;
  error: "Search query is required and must be at least 1 character"
}
```

---

## User Management

### Get All Users
```http
GET /api/v1/users
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  name?: string;
  email?: string;
  role?: "SUPER_MANAGER" | "MANAGER" | "PRINCIPAL" | "VICE_PRINCIPAL" | "BURSAR" | "DISCIPLINE_MASTER" | "TEACHER" | "HOD" | "PARENT" | "STUDENT";
  status?: string;
  academicYearId?: number;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}
```

### Search Personnel
```http
GET /api/v1/users/personnel/search
Authorization: Bearer <token>
```

**Authorization:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `BURSAR`, `SECRETARY`, `DEAN_OF_STUDIES`, `DEAN_OF_DISCIPLINE`, `HOD`

Search staff users with pagination and multi-field filtering. **Parents are NOT personnel and are never returned by this endpoint** — use the parent-directory endpoints instead. `q` performs a case-insensitive `contains` search across `name`, `email`, `matricule`, and `phone`. Passing `role=PARENT` returns a `400`.

**Query Parameters:**
```typescript
{
  q?: string;                     // free-text search across name/email/matricule/phone
  name?: string;
  email?: string;
  matricule?: string;
  phone?: string;
  role?: string;                  // single personnel role OR comma-separated list (e.g. "TEACHER,HOD")
  roles?: string;                 // alias for `role`; comma-separated list
  gender?: "Male" | "Female";
  status?: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  academicYearId?: number;        // scopes role match; defaults to current year
  page?: number;                  // default 1
  limit?: number;                 // default 20, max 100
  sortBy?: "id" | "name" | "email" | "matricule" | "phone" | "gender" | "status" | "createdAt" | "updatedAt" | "dateOfBirth" | "lastSeenAt";
  sortOrder?: "asc" | "desc";     // default asc
}
```

**Allowed roles:** `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `BURSAR`, `CONTROLLER`, `TEACHER`, `DISCIPLINE_MASTER`, `SENIOR_DISCIPLINE_MASTER`, `DEAN_OF_DISCIPLINE`, `DEAN_OF_STUDIES`, `FEE_AUDITOR`, `SECRETARY`, `NURSE`, `GUIDANCE_COUNSELOR`, `HOD`

**Success Response (200):**
```typescript
{
  success: true,
  data: Array<{
    id: number;
    name: string;
    email: string;
    matricule: string | null;
    phone: string;
    gender: "Male" | "Female";
    status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
    dateOfBirth: string;
    address: string;
    photo: string | null;
    userRoles: Array<{ id: number; role: string; academicYearId: number | null }>;
    subjects?: Array<{ id: number; name: string; category: string }>; // teachers only
    createdAt: string;
    updatedAt: string;
  }>,
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }
}
```

**Error Responses:**
- `400` — invalid `page`, `limit`, `role`, `gender`, `status`, `sortBy`, `sortOrder`, or `academicYearId`
- `401` — missing/invalid token
- `403` — caller lacks the required role
- `500` — unexpected server error

```json
{ "success": false, "error": "limit must be an integer between 1 and 100" }
```

**Example:**
```
GET /api/v1/users/personnel/search?q=john&role=TEACHER,HOD&status=ACTIVE&page=1&limit=25&sortBy=name&sortOrder=asc
```

### Create User
```http
POST /api/v1/users
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  name: string;
  email: string;
  password: string;
  gender: "MALE" | "FEMALE";
  dateOfBirth: string;   // "YYYY-MM-DD"
  phone: string;
  address: string;
  idCardNum?: string;
  photo?: string;
  roles: Array<{
    role: "SUPER_MANAGER" | "MANAGER" | "PRINCIPAL" | "VICE_PRINCIPAL" | "BURSAR" | "DISCIPLINE_MASTER" | "TEACHER" | "HOD" | "PARENT" | "STUDENT";
    academicYearId?: number; // null for global roles
  }>;
}
```

### Get User by ID
```http
GET /api/v1/users/:id
Authorization: Bearer <token>
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `BURSAR`, `SECRETARY`

### Update User
```http
PUT /api/v1/users/:id
Authorization: Bearer <token>
```

**Authorization:** `SUPER_MANAGER`, `PRINCIPAL`, `VICE_PRINCIPAL`, `BURSAR`, `SECRETARY`

Used to update any user record — including parents (parents are stored as `User` records with role `PARENT`). Send only the fields you want to change.

**Request Body (all fields optional):**
```typescript
{
  name?: string;
  email?: string;
  phone?: string;
  whatsappNumber?: string;
  address?: string;
  gender?: "Male" | "Female";
  dateOfBirth?: string;               // ISO date
  password?: string;                  // Will be hashed
  status?: "ACTIVE" | "INACTIVE" | "SUSPENDED";
}
```

### Delete User
```http
DELETE /api/v1/users/:id
Authorization: Bearer <token>
```

### Get User Profile
```http
GET /api/v1/users/me
Authorization: Bearer <token>
```

### Update User Profile
```http
PUT /api/v1/users/me
Authorization: Bearer <token>
```

### Assign Role
```http
POST /api/v1/users/:id/roles
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  role: string;
  academicYearId?: number; // null for global roles
}
```

### Remove Role
```http
DELETE /api/v1/users/:id/roles
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  role: string;
  academicYearId?: number;
}
```

---

## Exam and Marks Management

### Get All Exams
```http
GET /api/v1/exams
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  subjectId?: number;
  page?: number;
  limit?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    subjectId: number;
    academicYearId: number;
    examDate: string;
    duration: number;
    // ... other exam fields
  }>;
}
```

### Get Student Marks
```http
GET /api/v1/marks
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  studentId?: number;
  subjectId?: number;
  examSequenceId?: number;
  academicYearId?: number;
  page?: number;
  limit?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    enrollmentId: number;
    teacherId: number;
    examSequenceId: number;
    score: number;
    subClassSubjectId: number;
    createdAt: string;
    updatedAt: string;
    // ... other mark fields
  }>;
}
```

---

## Class and Subject Management

### Get All Classes
```http
GET /api/v1/classes
Authorization: Bearer <token>
```
**Description:**
Retrieves a list of all classes in the system. Can include subclasses and student counts. Supports pagination and filtering. Set `legacy=true` to get a nested structure with subclasses.

**Authorization:**
- Any authenticated user.

**Query Parameters:**
```typescript
{
  name?: string;           // Optional: Filter by class name
  id?: number;             // Optional: Filter by class ID
  level?: number;          // Optional: Filter by class level
  legacy?: "true" | "false"; // Optional: If "true", returns classes with nested subclasses and student counts (old format)
  page?: number;           // Optional: Page number for pagination (default: 1)
  limit?: number;          // Optional: Number of items per page (default: 10)
  sortBy?: "name" | "id";  // Optional: Field to sort by (e.g., "name", "id")
  sortOrder?: "asc" | "desc"; // Optional: Sort order (default: "asc")
}
```

**Response (200 - Paginated):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    level: number;
    baseFee: number;
    newStudentFee: number;
    oldStudentFee: number;
    miscellaneousFee: number;
    firstTermFee: number;
    secondTermFee: number;
    thirdTermFee: number;
    createdAt: string;
    updatedAt: string;
    studentCount: number; // Total students in all subclasses of this class for the current academic year
    academicYearId: number; // ID of the current academic year
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}
```

**Response (200 - Legacy `legacy=true`):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    maxStudents: number; // Max students for the class (theoretical, not enforced)
    level: number;
    baseFee: number;
    newStudentFee: number;
    oldStudentFee: number;
    miscellaneousFee: number;
    firstTermFee: number;
    secondTermFee: number;
    thirdTermFee: number;
    createdAt: string;
    updatedAt: string;
    studentCount: number; // Total students across all subclasses of this class
    academicYearId: number; // Current academic year ID
    subClasses: Array<{
      id: number;
      name: string;
      classId: number;
      classMasterId?: number;
      studentCount: number; // Students in this specific subclass
      createdAt: string;
      updatedAt: string;
      subClassSubjects: Array<{ // Simplified for legacy, shows subject IDs
        subjectId: number;
      }>;
    }>;
  }>;
}
```

### Create Class
```http
POST /api/v1/classes
Authorization: Bearer <token>
```
**Description:**
Creates a new class.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Request Body:**
```typescript
{
  name: string;        // Required
  level?: number;      // Optional
  baseFee?: number;
  newStudentFee?: number;
  oldStudentFee?: number;
  miscellaneousFee?: number;
  firstTermFee?: number;
  secondTermFee?: number;
  thirdTermFee?: number;
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Class created successfully";
  data: {
    id: number;
    name: string;
    level: number;
    baseFee: number;
    newStudentFee: number;
    oldStudentFee: number;
    miscellaneousFee: number;
    firstTermFee: number;
    secondTermFee: number;
    thirdTermFee: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Get Class by ID
```http
GET /api/v1/classes/:id
Authorization: Bearer <token>
```
**Description:**
Retrieves details for a specific class by its ID, including its subclasses, their class masters, and student counts for each.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `id` (number): The ID of the class.

**Response (200):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    level: number;
    baseFee: number;
    newStudentFee: number;
    oldStudentFee: number;
    miscellaneousFee: number;
    firstTermFee: number;
    secondTermFee: number;
    thirdTermFee: number;
    createdAt: string;
    updatedAt: string;
    studentCount: number; // Total students across all subclasses of this class for the current academic year
    academicYearId: number; // ID of the current academic year
    subClasses: Array<{
      id: number;
      name: string;
      classId: number;
      classMasterId?: number;
      createdAt: string;
      updatedAt: string;
      studentCount: number; // Students in this specific subclass for the current academic year
      classMaster?: { // Class master user object if assigned
        id: number;
        name: string;
        matricule: string;
        email: string;
        // ... other user fields
      };
    }>;
  };
}
```

### Update Class Details
```http
PUT /api/v1/classes/:id
Authorization: Bearer <token>
```
**Description:**
Updates the details of a class. If fee-related fields are updated, it triggers an update of all associated student fees.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `id` (number): The ID of the class to update.

**Request Body:**
```typescript
{
  name?: string;
  level?: number;
  baseFee?: number;
  newStudentFee?: number;
  oldStudentFee?: number;
  miscellaneousFee?: number;
  firstTermFee?: number;
  secondTermFee?: number;
  thirdTermFee?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Class updated successfully";
  data: {
    id: number;
    name: string;
    level: number;
    baseFee: number;
    newStudentFee: number;
    oldStudentFee: number;
    miscellaneousFee: number;
    firstTermFee: number;
    secondTermFee: number;
    thirdTermFee: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Delete a Class
```http
DELETE /api/v1/classes/:id
Authorization: Bearer <token>
```
**Description:**
Deletes a class. This operation will fail if there are any subclasses or enrollments associated with this class.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `id` (number): The ID of the class to delete.

**Response (200):**
```typescript
{
  success: true;
  message: "Class deleted successfully";
}
```
**Error Responses:**
- `400`: `Invalid class ID format`
- `404`: `Class not found`
- `409`: `Cannot delete class, it has associated subclasses` or `Cannot delete class, it has associated enrollments`

### Get All Subclasses
```http
GET /api/v1/classes/sub-classes
GET /api/v1/classes/subclasses
Authorization: Bearer <token>
```
**Description:**
Retrieves a paginated list of all subclasses across all classes, or filtered by a specific class. Can optionally include subjects taught in each subclass and their coefficients.

**Authorization:**
- Any authenticated user.

**Query Parameters:**
```typescript
{
  name?: string;           // Optional: Filter by subclass name
  id?: number;             // Optional: Filter by subclass ID
  classId?: number;        // Optional: Filter by parent class ID
  includeSubjects?: "true" | "false"; // Optional: If "true", includes subjects taught in the subclass with their coefficients.
  page?: number;           // Optional: Page number for pagination (default: 1)
  limit?: number;          // Optional: Number of items per page (default: 10)
  sortBy?: "name" | "id";  // Optional: Field to sort by
  sortOrder?: "asc" | "desc"; // Optional: Sort order
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    classId: number;
    classMasterId?: number;
    createdAt: string;
    updatedAt: string;
    class: { // Parent class details
      id: number;
      name: string;
      level: number;
      // ... other class fields
    };
    classMaster?: { // Class master user object if assigned
      id: number;
      name: string;
      matricule: string;
      email: string;
      // ... other user fields
    };
    studentCount: number; // Number of students enrolled in this subclass for the current academic year
    academicYearId: number; // ID of the current academic year
    subjects?: Array<{ // Included if includeSubjects=true
      id: number;
      name: string;
      category: string;
      coefficient: number; // Coefficient specific to this subclass-subject link
      // ... other subject fields
    }>;
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}
```

### Get Subclasses for a Specific Class
```http
GET /api/v1/classes/:id/sub-classes
GET /api/v1/classes/:id/subclasses
Authorization: Bearer <token>
```
**Description:**
Retrieves all subclasses belonging to a specific class. This endpoint redirects to the general `getAllSubclasses` endpoint, applying the class ID filter. It inherits all query parameters from `GET /api/v1/classes/sub-classes`.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `id` (number): The ID of the parent class.

**Query Parameters:**
- Same as `GET /api/v1/classes/sub-classes` (e.g., `includeSubjects`, `page`, `limit`).

**Response (200):**
- Same as `GET /api/v1/classes/sub-classes`, but filtered by `classId`.

### Add a New Subclass to a Class
```http
POST /api/v1/classes/:id/sub-classes
POST /api/v1/classes/:id/subclasses
Authorization: Bearer <token>
```
**Description:**
Adds a new subclass to an existing class.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `id` (number): The ID of the class to add the subclass to.

**Request Body:**
```typescript
{
  name: string; // Required: Name of the new subclass (e.g., "A", "B", "Form 1A")
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Subclass created successfully";
  data: {
    id: number;
    name: string;
    classId: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Update a Subclass
```http
PUT /api/v1/classes/:id/sub-classes/:subClassId
PUT /api/v1/classes/:id/subclasses/:subClassId
Authorization: Bearer <token>
```
**Description:**
Updates the details of a specific subclass.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `id` (number): The ID of the parent class.
- `subClassId` (number): The ID of the subclass to update.

**Request Body:**
```typescript
{
  name: string; // Required: New name for the subclass
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Subclass updated successfully";
  data: {
    id: number;
    name: string;
    classId: number;
    classMasterId?: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Delete a Subclass
```http
DELETE /api/v1/classes/:id/sub-classes/:subClassId
DELETE /api/v1/classes/:id/subclasses/:subClassId
Authorization: Bearer <token>
```
**Description:**
Deletes a specific subclass. This operation will fail if students are currently enrolled in the subclass.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `id` (number): The ID of the parent class (for verification).
- `subClassId` (number): The ID of the subclass to delete.

**Response (200):**
```typescript
{
  success: true;
  message: "Subclass deleted successfully";
}
```
**Error Response (409 - Conflict):**
```typescript
{
  success: false;
  error: "Cannot be deleted, subclass already has students";
}
```

### Assign a Class Master to a Subclass
```http
POST /api/v1/classes/sub-classes/:subClassId/class-master
POST /api/v1/classes/subclasses/:subClassId/class-master
Authorization: Bearer <token>
```
**Description:**
Assigns a user (who must have a 'TEACHER' role in the current academic year) as the class master for a specific subclass.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `subClassId` (number): The ID of the subclass.

**Request Body:**
```typescript
{
  userId: number; // Required: The ID of the user to assign as class master
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    classId: number;
    classMasterId: number;
    createdAt: string;
    updatedAt: string;
    class: { /* ... parent class details ... */ };
    classMaster: { /* ... assigned teacher user details ... */ };
  };
}
```
**Error Responses:**
- `400`: `Invalid subclass ID format` or `User ID is required` or `User with ID X does not have a teacher role in the current academic year`
- `404`: `Subclass with ID X not found` or `User with ID X not found`

### Get the Class Master of a Subclass
```http
GET /api/v1/classes/sub-classes/:subClassId/class-master
GET /api/v1/classes/subclasses/:subClassId/class-master
Authorization: Bearer <token>
```
**Description:**
Retrieves the user details of the class master assigned to a specific subclass.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `subClassId` (number): The ID of the subclass.

**Response (200):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    email: string;
    matricule: string;
    gender: "MALE" | "FEMALE";
    dateOfBirth: string;
    phone: string;
    address: string;
    idCardNum?: string;
    photo?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    userRoles: Array<{
      id: number;
      userId: number;
      role: "TEACHER";
      academicYearId?: number;
      createdAt: string;
      updatedAt: string;
    }>;
  };
}
```
**Response (200 - No Master):**
```typescript
{
  success: true;
  data: null;
}
```
**Error Responses:**
- `400`: `Invalid subclass ID format`
- `404`: `Subclass with ID X not found`

### Remove the Class Master from a Subclass
```http
DELETE /api/v1/classes/sub-classes/:subClassId/class-master
DELETE /api/v1/classes/subclasses/:subClassId/class-master
Authorization: Bearer <token>
```
**Description:**
Removes the assigned class master from a specific subclass.

**Authorization:**
- `SUPER_MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `subClassId` (number): The ID of the subclass.

**Response (200):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    classId: number;
    classMasterId: null; // Class master is now null
    createdAt: string;
    updatedAt: string;
    class: { /* ... parent class details ... */ };
  };
}
```
**Error Responses:**
- `400`: `Invalid subclass ID format`
- `404`: `Subclass with ID X not found`

### Get All Subjects for a Specific Subclass
```http
GET /api/v1/classes/sub-classes/:subClassId/subjects
GET /api/v1/classes/subclasses/:subClassId/subjects
Authorization: Bearer <token>
```
**Description:**
Retrieves all subjects assigned to a specific subclass, including the coefficient for each subject within that subclass.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `subClassId` (number): The ID of the subclass.

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    code?: string;
    category: "SCIENCE" | "ARTS" | "COMMERCIAL" | "LANGUAGES" | "OTHER";
    coefficient: number; // Coefficient specific to this subclass-subject link
    createdAt: string;
    updatedAt: string;
  }>;
}
```
**Error Responses:**
- `400`: `Invalid sub_class ID format`
- `404`: `Subclass with ID X not found`


### Get All Subjects
```http
GET /api/v1/subjects
Authorization: Bearer <token>
```
**Description:**
Retrieves a paginated list of all subjects in the system. Can optionally include assigned teachers and linked subclasses.

**Authorization:**
- Any authenticated user.

**Query Parameters:**
```typescript
{
  name?: string;           // Optional: Filter by subject name
  category?: "SCIENCE" | "ARTS" | "COMMERCIAL" | "LANGUAGES" | "OTHER"; // Optional: Filter by subject category
  id?: number;             // Optional: Filter by subject ID
  includeTeachers?: "true" | "false"; // Optional: If "true", includes teachers assigned to the subject.
  includeSubClasses?: "true" | "false"; // Optional: If "true", includes subclasses linked to the subject with their coefficients.
  page?: number;           // Optional: Page number for pagination (default: 1)
  limit?: number;          // Optional: Number of items per page (default: 10)
  sortBy?: "name" | "id" | "category"; // Optional: Field to sort by
  sortOrder?: "asc" | "desc"; // Optional: Sort order
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    code?: string;
    category: "SCIENCE" | "ARTS" | "COMMERCIAL" | "LANGUAGES" | "OTHER";
    createdAt: string;
    updatedAt: string;
    teachers?: Array<{ // Included if includeTeachers=true
      id: number;
      name: string;
      email: string;
      matricule: string;
      // ... other teacher user details
    }>;
    subClasses?: Array<{ // Included if includeSubClasses=true
      id: number;
      name: string;
      className: string; // Name of the parent class
      classId: number;
      coefficient: number; // Coefficient specific to this subject-subclass link
      // ... other subclass details
    }>;
  }>;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}
```

### Create New Subject
```http
POST /api/v1/subjects
Authorization: Bearer <token>
```
**Description:**
Creates a new subject.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Request Body:**
```typescript
{
  name: string;                               // Required: Name of the subject (e.g., "Mathematics")
  category: "SCIENCE" | "ARTS" | "COMMERCIAL" | "LANGUAGES" | "OTHER"; // Required: Category of the subject
}
```

**Response (201):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    category: "SCIENCE" | "ARTS" | "COMMERCIAL" | "LANGUAGES" | "OTHER";
    createdAt: string;
    updatedAt: string;
  };
}
```

### Get Subject by ID
```http
GET /api/v1/subjects/:id
Authorization: Bearer <token>
```
**Description:**
Retrieves details for a specific subject by its ID, including assigned teachers and linked subclasses with their coefficients.

**Authorization:**
- Any authenticated user.

**Path Parameters:**
- `id` (number): The ID of the subject.

**Response (200):**
```typescript
{
  success: true;
  data: {
    id: number;
    name: string;
    code?: string;
    category: "SCIENCE" | "ARTS" | "COMMERCIAL" | "LANGUAGES" | "OTHER";
    createdAt: string;
    updatedAt: string;
    teachers: Array<{ // Always included
      id: number;
      name: string;
      email: string;
      matricule: string;
      // ... other teacher user details
    }>;
    subClasses: Array<{ // Always included
      id: number;
      name: string;
      className: string; // Name of the parent class
      classId: number;
      coefficient: number; // Coefficient specific to this subject-subclass link
      // ... other subclass details
    }>;
  };
}
```

### Update Subject Details
```http
PUT /api/v1/subjects/:id
Authorization: Bearer <token>
```
**Description:**
Updates the details of a subject.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `id` (number): The ID of the subject to update.

**Request Body:**
```typescript
{
  name?: string;     // Optional: New name for the subject
  category?: "SCIENCE" | "ARTS" | "COMMERCIAL" | "LANGUAGES" | "OTHER"; // Optional: New category for the subject
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Subject updated successfully";
  data: {
    id: number;
    name: string;
    category: string;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Delete a Subject
```http
DELETE /api/v1/subjects/:id
Authorization: Bearer <token>
```
**Description:**
Deletes a subject. This will also delete all associated teacher assignments and subclass links for this subject.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `id` (number): The ID of the subject to delete.

**Response (200):**
```typescript
{
  success: true;
  message: "Subject deleted successfully";
}
```

### Assign a Teacher to a Subject
```http
POST /api/v1/subjects/:id/teachers
Authorization: Bearer <token>
```
**Description:**
Assigns a teacher to a specific subject. If the assignment already exists, it returns the existing record.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `id` (number): The ID of the subject to assign the teacher to.

**Request Body:**
```typescript
{
  teacherId: number; // Required: The ID of the user (teacher) to assign.
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Teacher assigned successfully";
  data: {
    teacher: {
      id: number;
      subjectId: number;
      teacherId: number;
      createdAt: string;
      updatedAt: string;
    };
  };
}
```

### Link Subject to a Subclass (with Coefficient)
```http
POST /api/v1/subjects/:id/sub-classes
Authorization: Bearer <token>
```
**Description:**
Links a subject to a specific subclass and sets its coefficient for that subclass.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `id` (number): The ID of the subject to link.

**Request Body:**
```typescript
{
  subClassId: number;   // Required: The ID of the subclass.
  coefficient: number;  // Required: The coefficient for this subject in this subclass.
}
```

**Response (201):**
```typescript
{
  success: true;
  data: {
    id: number;
    subjectId: number;
    subClassId: number;
    coefficient: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### Unlink Subject from a Subclass
```http
DELETE /api/v1/subjects/:subjectId/sub-classes/:subClassId
Authorization: Bearer <token>
```
**Description:**
Removes the link between a subject and a specific subclass. This effectively means the subject is no longer taught in that subclass.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `subjectId` (number): The ID of the subject to unlink.
- `subClassId` (number): The ID of the subclass from which to unlink the subject.

**Response (200):**
```typescript
{
  success: true;
  message: "Subject ID X successfully unlinked from subclass ID Y";
}
```
**Error Responses:**
- `400`: `Invalid subject ID or subclass ID`
- `404`: `Subject-subclass link not found` or `Subject with ID X is not linked to subclass with ID Y`
- `500`: `Failed to unlink subject from subclass: [error message]`

### Assign a Subject to All Subclasses of a Class
```http
POST /api/v1/subjects/:subjectId/classes/:classId
Authorization: Bearer <token>
```
**Description:**
Assigns a subject to all existing subclasses within a specified class. If a subject is already linked to a subclass, the existing link is returned.

**Authorization:**
- `SUPER_MANAGER`, `MANAGER`, `PRINCIPAL`

**Path Parameters:**
- `subjectId` (number): The ID of the subject to assign.
- `classId` (number): The ID of the class whose subclasses will receive the subject.

**Request Body:**
```typescript
{
  coefficient: number;  // Required: The coefficient for this subject in all assigned subclasses.
}
```

**Response (201):**
```typescript
{
  success: true;
  message: "Subject successfully assigned to all subclasses of class ID X";
  data: Array<{ // Array of SubClassSubject objects created or found
    id: number;
    subjectId: number;
    subClassId: number;
    coefficient: number;
    createdAt: string;
    updatedAt: string;
  }>;
}
```
**Error Responses:**
- `400`: `Invalid class ID or subject ID` or `Coefficient are required`
- `404`: `No subclasses found for class with ID X` or `Subject with ID X not found`

---

## Dashboard Endpoints

### Get User Dashboard
```http
GET /api/v1/users/me/dashboard
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  role?: "SUPER_MANAGER" | "MANAGER" | "PRINCIPAL" | "VICE_PRINCIPAL" | "BURSAR" | "DISCIPLINE_MASTER" | "TEACHER" | "HOD" | "PARENT" | "STUDENT";
  academicYearId?: number;
}
```

**Response varies by role:**

#### Super Manager Dashboard:
```typescript
{
  success: true;
  data: {
    academicYearCount: number;
    personnelCount: number;
    studentCount: number;
    classCount: number;
    subClassCount: number;
    totalFeesCollected: number;
    pendingReports: number;
    systemModifications: Array<object>;
    upcomingDeadlines: Array<object>;
  };
}
```

#### Principal Dashboard:
```typescript
{
  success: true;
  data: {
    totalStudents: number;
    totalTeachers: number;
    totalClasses: number;
    activeExamSequences: number;
    pendingDisciplineIssues: number;
    averageAttendanceRate: number;
  };
}
```

#### Vice Principal Dashboard:
```typescript
{
  success: true;
  data: {
    assignedSubClasses: number;
    totalStudentsUnderSupervision: number;
    studentsAwaitingAssignment: number;
    completedInterviews: number;
    pendingInterviews: number;
    recentDisciplineIssues: number;
    classesWithPendingReports: number;
    teacherAbsences: number;
  };
}
```

#### Bursar Dashboard:
```typescript
{
  success: true;
  data: {
    totalFeesExpected: number;
    totalFeesCollected: number;
    pendingPayments: number;
    collectionRate: number;
    recentTransactions: number;
    newStudentsThisMonth: number;
    paymentMethods: Array<{
      method: string;
      count: number;
      totalAmount: number;
    }>;
  };
}
```

#### Discipline Master Dashboard:
```typescript
{
  success: true;
  data: {
    pendingDisciplineIssues: number;
    resolvedThisWeek: number;
    studentsWithMultipleIssues: number;
    averageResolutionTime: number;
    attendanceRate: number;
    latenessIncidents: number;
    absenteeismCases: number;
  };
}
```

#### Teacher Dashboard:
```typescript
{
  success: true;
  data: {
    subjectsTeaching: number;
    totalStudentsTeaching: number;
    marksToEnter: number;
    classesTaught: number;
    upcomingPeriods: number;
    weeklyHours: number;
    attendanceRate: number;
    totalHoursPerWeek: number;
  };
}
```

---

## Authorization Testing

### Unauthorized Access (No Token)
```http
GET /api/v1/users
```

**Response (401):**
```typescript
{
  success: false;
  error: "User not authenticated";
}
```

### Teacher Access to Admin Endpoint
```http
GET /api/v1/users
Authorization: Bearer <teacher_token>
```

**Response (403):**
```typescript
{
  success: false;
  error: "Access denied: insufficient permissions";
}
```

### Parent Access to Teacher Endpoint
```http
GET /api/v1/teachers/me/subjects
Authorization: Bearer <parent_token>
```

**Response (403):**
```typescript
{
  success: false;
  error: "Access denied: insufficient permissions";
}
```

---

## Super Manager (System Administration)

### Get System Settings
```http
GET /api/v1/system/settings
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    schoolName: string;
    schoolAddress: string;
    schoolPhone: string;
    schoolEmail: string;
    schoolLogo?: string;
    academicYearStartMonth: number; // 1-12
    defaultClassSize: number;
    enableNotifications: boolean;
    enableParentPortal: boolean;
    enableQuizSystem: boolean;
    defaultPassMark: number;
    currencySymbol: string; // "FCFA"
    timezone: string;
    backupEnabled: boolean;
    backupFrequency: "DAILY" | "WEEKLY" | "MONTHLY";
    maintenanceMode: boolean;
  };
}
```

### Update System Settings
```http
PUT /api/v1/system/settings
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  schoolName?: string;
  schoolAddress?: string;
  schoolPhone?: string;
  schoolEmail?: string;
  schoolLogo?: string;
  academicYearStartMonth?: number;
  defaultClassSize?: number;
  enableNotifications?: boolean;
  enableParentPortal?: boolean;
  enableQuizSystem?: boolean;
  defaultPassMark?: number;
  currencySymbol?: string;
  timezone?: string;
  backupEnabled?: boolean;
  backupFrequency?: "DAILY" | "WEEKLY" | "MONTHLY";
  maintenanceMode?: boolean;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "System settings updated successfully";
  data: {
    // Updated settings object (same structure as GET)
  };
}
```

### Get System Health
```http
GET /api/v1/system/health
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    status: "HEALTHY" | "WARNING" | "CRITICAL";
    uptime: number; // seconds
    databaseStatus: "CONNECTED" | "DISCONNECTED" | "ERROR";
    memoryUsage: {
      used: number; // MB
      total: number; // MB
      percentage: number;
    };
    diskUsage: {
      used: number; // MB
      total: number; // MB
      percentage: number;
    };
    activeUsers: number;
    recentErrors: number;
    lastBackup: string | null;
    systemVersion: string;
  };
}
```

### Perform System Backup
```http
POST /api/v1/system/backup
Authorization: Bearer <token>
```

**Response (201):**
```typescript
{
  success: true;
  message: "System backup completed successfully";
  data: {
    id: string;
    timestamp: string;
    type: "MANUAL" | "SCHEDULED";
    status: "SUCCESS" | "FAILED" | "IN_PROGRESS";
    filePath?: string;
    fileSize?: number; // bytes
    duration?: number; // milliseconds
    errorMessage?: string;
  };
}
```

### Perform System Cleanup
```http
POST /api/v1/system/cleanup
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  message: "System cleanup completed. X records cleaned, Y.Z MB freed.";
  data: {
    operations: Array<{
      operation: string;
      recordsCleaned: number;
      spaceFreed: number; // bytes
      duration: number; // milliseconds
    }>;
    summary: {
      totalRecordsCleaned: number;
      totalSpaceFreed: number; // bytes
      totalSpaceFreedMB: number;
    };
  };
}
```

### Get System Logs
```http
GET /api/v1/system/logs
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  level?: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  category?: "AUTH" | "DATABASE" | "SYSTEM" | "USER_ACTION" | "ERROR";
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  userId?: number;
  search?: string;
  limit?: number; // max 1000, default 100
}
```

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: string;
    timestamp: string;
    level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
    category: "AUTH" | "DATABASE" | "SYSTEM" | "USER_ACTION" | "ERROR";
    message: string;
    userId?: number;
    ipAddress?: string;
    details?: any;
  }>;
  meta: {
    total: number;
    limit: number;
    filters: object;
  };
}
```

### Get System Statistics
```http
GET /api/v1/system/statistics
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    userStatistics: {
      totalUsers: number;
      totalStudents: number;
      totalTeachers: number;
      totalParents: number;
      recentLogins: number;
    };
    academicStatistics: {
      totalClasses: number;
      totalSubjects: number;
      totalEnrollments: number;
      currentAcademicYear: string;
    };
    financialStatistics: {
      totalFees: number;
      totalPayments: number;
    };
    systemHealth: {
      // Same structure as /system/health
    };
  };
}
```

### Get System Dashboard
```http
GET /api/v1/system/dashboard
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    // Combines statistics + health + additional dashboard data
    userStatistics: object;
    academicStatistics: object;
    financialStatistics: object;
    systemHealth: object;
    quickActions: Array<string>;
    recentActivities: Array<object>;
  };
}
```

### Get System Info
```http
GET /api/v1/system/info
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    schoolName: string;
    systemVersion: string;
    uptime: number;
    status: "HEALTHY" | "WARNING" | "CRITICAL";
    maintenanceMode: boolean;
  };
}
```

### Toggle Maintenance Mode
```http
POST /api/v1/system/maintenance-mode
Authorization: Bearer <token>
```

**Request Body:**
```typescript
{
  enabled: boolean;
}
```

**Response (200):**
```typescript
{
  success: true;
  message: "Maintenance mode enabled/disabled";
  data: {
    maintenanceMode: boolean;
  };
}
```

### Get Sync Status
Shows the most recent database-sync run against the remote peer, live peer
reachability, and the auto-sync configuration read from environment.

```http
GET /api/v1/system/sync/status
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    lastSync: null | {
      id: number;
      syncId: string;
      startTime: string;                 // ISO
      endTime: string | null;
      status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "PARTIAL" | "FAILED";
      direction: "PUSH" | "PULL" | "BIDIRECTIONAL";
      recordsProcessed: number;
      conflicts: any[];
      errors: string[];
      createdAt: string;
    };
    isOnline: boolean;                   // remote peer reachable right now
    remotePeerConfigured: boolean;       // REMOTE_SYNC_URL is set
    autoSyncEnabled: boolean;            // AUTO_SYNC_INTERVAL > 0
    autoSyncIntervalMinutes: number | null;
    serverId: string;
    syncInFlight: boolean;               // true while a manual /trigger is running
  };
}
```

### List Recent Sync Runs
```http
GET /api/v1/system/sync/logs?limit=20
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type   | Default | Notes                   |
|-----------|--------|---------|-------------------------|
| limit     | number | 20      | Clamped to 1..100       |

**Response (200):**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    syncId: string;
    startTime: string;
    endTime: string | null;
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "PARTIAL" | "FAILED";
    direction: "PUSH" | "PULL" | "BIDIRECTIONAL";
    recordsProcessed: number;
    conflicts: any[];
    errors: string[];
    createdAt: string;
  }>;
}
```

### Trigger Manual Sync
Runs a bidirectional sync against the remote peer synchronously. Overlapping
calls are coalesced — a second call while one is in flight returns the same
result. Returns `409` when `REMOTE_SYNC_URL` is not configured.

```http
POST /api/v1/system/sync/trigger
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  message: "Manual sync run finished";
  data: {
    syncLog: {
      id: string;                       // in-memory run id from SyncManager
      startTime: string;
      endTime: string | null;
      status: "COMPLETED" | "PARTIAL" | "FAILED";
      direction: "BIDIRECTIONAL";
      recordsProcessed: number;
      conflicts: any[];
      errors: string[];
    };
  };
}
```

**Error Responses:**
- `409` — `REMOTE_SYNC_URL` is not configured on this server.
- `500` — sync failed; `error` field carries the reason.

---

## Principal (School-wide Management)

### Get Principal Dashboard
```http
GET /api/v1/principal/dashboard
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    schoolAnalytics: {
      totalStudents: number;
      totalTeachers: number;
      totalClasses: number;
      totalSubjects: number;
      activeExamSequences: number;
      averageAttendanceRate: number;
      overallAcademicPerformance: number;
      financialCollectionRate: number;
      disciplineIssuesThisMonth: number;
      newEnrollmentsThisMonth: number;
      teacherUtilizationRate: number;
      classCapacityUtilization: number;
    };
    performanceMetrics: {
      academicPerformance: {
        overallPassRate: number;
        averageGrade: number;
        subjectPerformance: Array<{
          subjectName: string;
          averageScore: number;
          passRate: number;
          totalStudents: number;
        }>;
        classPerformance: Array<{
          className: string;
          subClassName: string;
          averageScore: number;
          passRate: number;
          totalStudents: number;
          teacherName: string;
        }>;
      };
      attendanceMetrics: {
        overallAttendanceRate: number;
        classAttendanceRates: Array<object>;
        monthlyAttendanceTrends: Array<object>;
      };
      teacherPerformance: {
        totalTeachers: number;
        averageClassesPerTeacher: number;
        teacherEfficiency: Array<{
          teacherName: string;
          subjectsTeaching: number;
          averageStudentPerformance: number;
          classesManaged: number;
          attendanceRate: number;
        }>;
      };
    };
    financialOverview: {
      totalExpectedRevenue: number;
      totalCollectedRevenue: number;
      collectionRate: number;
      pendingPayments: number;
      paymentMethodBreakdown: Array<{
        method: string;
        amount: number;
        percentage: number;
        transactionCount: number;
      }>;
      outstandingDebts: Array<{
        studentName: string;
        className: string;
        amountOwed: number;
        daysOverdue: number;
      }>;
    };
    disciplineOverview: {
      totalIssues: number;
      resolvedIssues: number;
      pendingIssues: number;
      averageResolutionTime: number;
      issuesByType: Array<{
        issueType: string;
        count: number;
        trend: "INCREASING" | "DECREASING" | "STABLE";
      }>;
    };
    staffOverview: {
      totalStaff: number;
      teacherCount: number;
      administrativeStaff: number;
      staffUtilization: Array<{
        role: string;
        count: number;
        utilizationRate: number;
      }>;
    };
    quickActions: Array<string>;
  };
}
```

### Get School Analytics
```http
GET /api/v1/principal/analytics/school
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStudents: number;
    totalTeachers: number;
    totalClasses: number;
    totalSubjects: number;
    activeExamSequences: number;
    averageAttendanceRate: number;
    overallAcademicPerformance: number;
    financialCollectionRate: number;
    disciplineIssuesThisMonth: number;
    newEnrollmentsThisMonth: number;
    teacherUtilizationRate: number;
    classCapacityUtilization: number;
  };
}
```

### Get Performance Metrics
```http
GET /api/v1/principal/analytics/performance
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    academicPerformance: {
      overallPassRate: number;
      averageGrade: number;
      subjectPerformance: Array<{
        subjectName: string;
        averageScore: number;
        passRate: number;
        totalStudents: number;
      }>;
      classPerformance: Array<{
        className: string;
        subClassName: string;
        averageScore: number;
        passRate: number;
        totalStudents: number;
        teacherName: string;
      }>;
    };
    attendanceMetrics: {
      overallAttendanceRate: number;
      classAttendanceRates: Array<object>;
      monthlyAttendanceTrends: Array<object>;
    };
    teacherPerformance: {
      totalTeachers: number;
      averageClassesPerTeacher: number;
      teacherEfficiency: Array<{
        teacherName: string;
        subjectsTeaching: number;
        averageStudentPerformance: number;
        classesManaged: number;
        attendanceRate: number;
      }>;
    };
  };
}
```

### Get Financial Overview
```http
GET /api/v1/principal/analytics/financial
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalExpectedRevenue: number;
    totalCollectedRevenue: number;
    collectionRate: number;
    pendingPayments: number;
    monthlyCollectionTrends: Array<{
      month: string;
      collected: number;
      expected: number;
      collectionRate: number;
    }>;
    paymentMethodBreakdown: Array<{
      method: string;
      amount: number;
      percentage: number;
      transactionCount: number;
    }>;
    outstandingDebts: Array<{
      studentName: string;
      className: string;
      amountOwed: number;
      daysOverdue: number;
    }>;
  };
}
```

### Get Discipline Overview
```http
GET /api/v1/principal/analytics/discipline
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalIssues: number;
    resolvedIssues: number;
    pendingIssues: number;
    averageResolutionTime: number;
    issuesByType: Array<{
      issueType: string;
      count: number;
      trend: "INCREASING" | "DECREASING" | "STABLE";
    }>;
    studentsByIssueCount: Array<{
      studentName: string;
      className: string;
      issueCount: number;
      lastIssueDate: string;
    }>;
    monthlyTrends: Array<{
      month: string;
      totalIssues: number;
      resolvedIssues: number;
    }>;
  };
}
```

### Get Staff Overview
```http
GET /api/v1/principal/analytics/staff
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalStaff: number;
    teacherCount: number;
    administrativeStaff: number;
    staffUtilization: Array<{
      role: string;
      count: number;
      utilizationRate: number;
    }>;
    recentHires: Array<{
      name: string;
      role: string;
      hireDate: string;
      department: string;
    }>;
    staffPerformanceMetrics: Array<{
      staffName: string;
      role: string;
      performanceScore: number;
      responsibilities: number;
    }>;
  };
}
```

### Get Academic Performance Report
```http
GET /api/v1/principal/reports/academic-performance
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  classId?: number;
  subjectId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    academicPerformance: {
      overallPassRate: number;
      averageGrade: number;
      subjectPerformance: Array<object>; // Filtered by subjectId if provided
      classPerformance: Array<object>;   // Filtered by classId if provided
    };
    generatedAt: string;
    filters: {
      academicYearId: number | null;
      classId: number | null;
      subjectId: number | null;
    };
  };
}
```

### Get Attendance Analysis
```http
GET /api/v1/principal/reports/attendance-analysis
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string;   // "YYYY-MM-DD"
  classId?: number;
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    overallMetrics: {
      overallAttendanceRate: number;
      classAttendanceRates: Array<object>;
      monthlyAttendanceTrends: Array<object>;
    };
    dateRange: {
      startDate: string;
      endDate: string;
    };
    classFilter: number | null;
    summary: {
      totalAnalyzed: number;
      averageAttendanceRate: number;
      trendsIdentified: number;
      issuesDetected: number;
    };
    recommendations: Array<string>;
  };
}
```

### Get Teacher Performance Analysis
```http
GET /api/v1/principal/reports/teacher-performance
Authorization: Bearer <token>
```

**Query Parameters:**
```typescript
{
  academicYearId?: number;
  departmentId?: number;
  performanceThreshold?: number; // Default: 10
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    summary: {
      totalTeachers: number;
      aboveThreshold: number;
      needsImprovement: number;
      averagePerformance: number;
    };
    teacherAnalysis: Array<{
      teacherName: string;
      subjectsTeaching: number;
      averageStudentPerformance: number;
      classesManaged: number;
      attendanceRate: number;
      performanceCategory: "ABOVE_THRESHOLD" | "NEEDS_IMPROVEMENT";
      recommendations: Array<string>;
    }>;
    performanceThreshold: number;
    generatedAt: string;
  };
}
```

### Get Financial Performance Analysis
```http
GET /api/v1/principal/reports/financial-performance
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    totalExpectedRevenue: number;
    totalCollectedRevenue: number;
    collectionRate: number;
    pendingPayments: number;
    paymentMethodBreakdown: Array<object>;
    outstandingDebts: Array<object>;
    performanceIndicators: {
      collectionEfficiency: "EXCELLENT" | "GOOD" | "NEEDS_IMPROVEMENT";
      outstandingRisk: "HIGH" | "MEDIUM" | "LOW";
      diversificationIndex: "GOOD" | "LIMITED";
    };
    alerts: Array<string>;
    recommendations: Array<string>;
  };
}
```

### Get School Overview Summary
```http
GET /api/v1/principal/overview/summary
Authorization: Bearer <token>
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    keyMetrics: {
      totalStudents: number;
      totalTeachers: number;
      collectionRate: number;
      overallPassRate: number;
      attendanceRate: number;
      disciplineIssues: number;
    };
    alerts: Array<string>;
    trends: {
      enrollmentTrend: "INCREASING" | "STABLE" | "DECREASING";
      performanceTrend: "IMPROVING" | "STABLE" | "DECLINING";
      financialTrend: "POSITIVE" | "STABLE" | "CONCERNING";
    };
    priorities: Array<string>;
  };
}
```

---

## Error Handling

All endpoints return standardized error responses:

### 400 Bad Request
```typescript
{
  success: false;
  error: "Descriptive error message about invalid request";
}
```

### 401 Unauthorized
```typescript
{
  success: false;
  error: "User not authenticated" | "Invalid credentials";
}
```

### 403 Forbidden
```typescript
{
  success: false;
  error: "Access denied: insufficient permissions";
}
```

### 404 Not Found
```typescript
{
  success: false;
  error: "Resource not found";
}
```

### 409 Conflict
```typescript
{
  success: false;
  error: "Resource already exists" | "Conflict with current state";
}
```

### 500 Internal Server Error
```typescript
{
  success: false;
  error: "Internal server error message";
}
```

---

## Notes on Implementation

### Authentication
- All protected endpoints require `Authorization: Bearer <token>` header
- Tokens expire in 24 hours
- Login supports both email and matricule as identifier

### Data Conversion
- **Frontend Interface**: All requests and responses use **camelCase**
- **Backend Processing**: Internal processing uses snake_case
- **Middleware**: Automatic conversion between camelCase ↔ snake_case
- **API Documentation**: Shows camelCase (what developers actually use)

### Academic Year Context
- Most operations default to current academic year if not specified
- Academic year filtering is available on most endpoints

### Pagination
- Default: page=1, limit=10
- Maximum limit: typically 100
- Includes meta information: total, page, limit, totalPages

### Role-Based Access
- Endpoints are protected by role-based middleware
- Some endpoints have specific role requirements
- Teachers have access controls based on subject/subclass assignments

### Date Formats
- All dates are in "YYYY-MM-DD" format
- DateTime fields include time component
- Times are in "HH:mm" format

This documentation reflects the actual frontend interface using camelCase. The middleware handles automatic conversion to/from the backend's snake_case implementation. 
---

## Report Card Management

The Report Card Management system handles PDF report card generation for students and subclasses. It supports both individual student reports and combined subclass reports with background processing for large operations.

### Get Student Report Card
```http
GET /api/v1/report-cards/student/:studentId
Authorization: Bearer <token>
```

**Path Parameters:**
- `studentId` (number): Student ID

**Query Parameters:**
```typescript
{
  academicYearId: number;    // Required
  examSequenceId: number;    // Required
}
```

**Response (200 - Report Ready):**
- Returns PDF file for download
- Content-Type: application/pdf
- Content-Disposition: attachment; filename="report-student-{matricule}-seq-{sequenceId}.pdf"

**Response (202 - Processing):**
```typescript
{
  success: true;
  message: "Report generation is currently processing. Please try again later.";
  status: "PROCESSING"  < /dev/null |  "PENDING";
}
```

**Response (404 - Not Found):**
```typescript
{
  success: false;
  error: "Report record not found for this student. Generation might be pending, failed, or parameters incorrect.";
}
```

**Response (500 - Generation Failed):**
```typescript
{
  success: false;
  error: "Report generation failed for this student.";
  message: string;
  status: "FAILED";
}
```

### Generate Student Report Card
```http
POST /api/v1/report-cards/student/:studentId/generate
Authorization: Bearer <token>
Roles: SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL
```

**Path Parameters:**
- `studentId` (number): Student ID

**Request Body:**
```typescript
{
  academicYearId: number;   // Required
  examSequenceId: number;   // Required
}
```

**Response (200):**
- Triggers immediate report generation and download
- Returns PDF file for download
- Content-Type: application/pdf
- Content-Disposition: attachment; filename="report-card-student-{studentId}.pdf"

**Error Responses:**
```typescript
{
  success: false;
  error: "Valid studentId, academicYearId, and examSequenceId must be provided.";
}
```

### Get Subclass Report Cards
```http
GET /api/v1/report-cards/subclass/:subClassId
Authorization: Bearer <token>
```

**Path Parameters:**
- `subClassId` (number): Subclass ID

**Query Parameters:**
```typescript
{
  academicYearId: number;    // Required
  examSequenceId: number;    // Required
}
```

**Response (200 - Report Ready):**
- Returns combined PDF file for download containing all students in the subclass
- Content-Type: application/pdf
- Content-Disposition: attachment; filename="report-subclass-{className}-{subclassName}-seq-{sequenceId}.pdf"

**Response (202 - Processing):**
```typescript
{
  success: true;
  message: "Combined subclass report generation is currently processing. Please try again later.";
  status: "PROCESSING" | "PENDING";
}
```

**Response (404 - Not Found):**
```typescript
{
  success: false;
  error: "Combined subclass report record not found. It might not have been generated yet or the parameters are incorrect.";
}
```

### Generate Subclass Report Cards
```http
POST /api/v1/report-cards/subclass/:subClassId/generate
Authorization: Bearer <token>
Roles: SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL
```

**Path Parameters:**
- `subClassId` (number): Subclass ID

**Request Body:**
```typescript
{
  academicYearId: number;   // Required
  examSequenceId: number;   // Required
}
```

**Response (200):**
- Triggers immediate report generation and download for entire subclass
- Returns combined PDF file for download
- Content-Type: application/pdf
- Content-Disposition: attachment; filename="report-cards-subclass-{subClassId}.pdf"

**Error Responses:**
```typescript
{
  success: false;
  error: "Valid subClassId, academicYearId, and examSequenceId must be provided.";
}
```

### Report Card Features

**Individual Student Reports Include:**
- Student personal information (name, matricule, photo, class info)
- Subject-wise marks with coefficients and weighted calculations
- Category summaries (by subject category)
- Overall average and class ranking
- Class statistics (min, max, average, success rates)
- Teacher assignments for each subject
- Exam sequence information

**Subclass Combined Reports Include:**
- All individual student reports combined into a single PDF
- Each student report on a separate page
- Consistent formatting and styling
- Automatic page breaks between students

**Background Processing:**
- Large report generation is handled via BullMQ job queues
- Report status tracking: PENDING → PROCESSING → COMPLETED/FAILED
- Individual student reports can be extracted from combined subclass PDFs
- Automatic retry mechanisms for failed generations

**Report Status Tracking:**
Reports are tracked in the GeneratedReport table with statuses:
- `PENDING`: Report generation queued
- `PROCESSING`: Report currently being generated
- `COMPLETED`: Report successfully generated and available
- `FAILED`: Report generation failed

**File Management:**
- PDF files are stored in the server filesystem
- Individual student reports are extracted from combined PDFs using pdf-lib
- Generated reports are cached until regenerated
- File paths are stored in database for efficient retrieval

**Error Handling:**
- Validates required parameters (academicYearId, examSequenceId)
- Checks student enrollment and marks availability
- Handles missing files and corrupted PDFs
- Provides detailed error messages for debugging


### Check Student Report Card Availability (General)
```http
GET /api/v1/report-cards/student/:studentId/availability
Authorization: Bearer <token>
```

**Path Parameters:**
- `studentId` (number): Student ID

**Query Parameters:**
```typescript
{
  academicYearId: number;    // Required
  examSequenceId: number;    // Required
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    available: boolean;
    status: "COMPLETED"  < /dev/null |  "PENDING" | "PROCESSING" | "FAILED" | "NOT_ENROLLED" | "SEQUENCE_NOT_FOUND" | "NO_MARKS" | "NOT_GENERATED";
    message: string;
    reportData?: {
      studentName: string;
      matricule: string;
      className: string;
      examSequence: number;
      termName: string;
      filePath?: string;
      generatedAt?: string;
      errorMessage?: string;
      marksCount?: number;
    };
  };
}
```

### Check Subclass Report Card Availability (General)
```http
GET /api/v1/report-cards/subclass/:subClassId/availability
Authorization: Bearer <token>
```

**Path Parameters:**
- `subClassId` (number): Subclass ID

**Query Parameters:**
```typescript
{
  academicYearId: number;    // Required
  examSequenceId: number;    // Required
}
```

**Response (200):**
```typescript
{
  success: true;
  data: {
    available: boolean;
    status: "COMPLETED" | "PENDING" | "PROCESSING" | "FAILED" | "SUBCLASS_NOT_FOUND" | "SEQUENCE_NOT_FOUND" | "NO_STUDENTS" | "NO_MARKS" | "NOT_GENERATED";
    message: string;
    reportData?: {
      subClassName: string;
      enrolledStudents: number;
      examSequence: number;
      termName: string;
      filePath?: string;
      generatedAt?: string;
      errorMessage?: string;
      marksCount?: number;
    };
  };
}
```

### Check Child Report Card Availability (Parent)
```http
GET /api/v1/parent/children/:studentId/report-card/availability
Authorization: Bearer <token>
Roles: PARENT
```

**Path Parameters:**
- `studentId` (number): Child's student ID

**Query Parameters:**
```typescript
{
  academicYearId: number;    // Required
  examSequenceId: number;    // Required
}
```

**Response (200):**
Same as general student report card availability check above.

**Response (403):**
```typescript
{
  success: false;
  error: "You do not have permission to access this student's report card";
}
```

### Check Student Report Card Availability (Manager)
```http
GET /api/v1/manager/report-cards/student/:studentId/availability
Authorization: Bearer <token>
Roles: MANAGER, PRINCIPAL, SUPER_MANAGER
```

Same parameters and responses as general student availability check.

### Check Subclass Report Card Availability (Manager)
```http
GET /api/v1/manager/report-cards/subclass/:subClassId/availability
Authorization: Bearer <token>
Roles: MANAGER, PRINCIPAL, SUPER_MANAGER
```

Same parameters and responses as general subclass availability check.

### Check Student Report Card Availability (Principal)
```http
GET /api/v1/principal/report-cards/student/:studentId/availability
Authorization: Bearer <token>
Roles: PRINCIPAL
```

Same parameters and responses as general student availability check.

### Check Subclass Report Card Availability (Principal)
```http
GET /api/v1/principal/report-cards/subclass/:subClassId/availability
Authorization: Bearer <token>
Roles: PRINCIPAL
```

Same parameters and responses as general subclass availability check.

### Report Card Availability Status Codes

**Available Status Codes:**
- `COMPLETED`: Report card is ready for download
- `PENDING`: Report generation is queued
- `PROCESSING`: Report is currently being generated
- `FAILED`: Report generation failed
- `NOT_ENROLLED`: Student not enrolled for the academic year
- `SEQUENCE_NOT_FOUND`: Exam sequence not found
- `NO_MARKS`: No marks available for the student/subclass
- `NOT_GENERATED`: Report can be generated but hasn't been created yet
- `SUBCLASS_NOT_FOUND`: Subclass not found
- `NO_STUDENTS`: No students enrolled in the subclass

**Parent-Specific Features:**
- Parents can only check availability for their own children
- System verifies parent-child relationship before allowing access
- Returns 403 Forbidden if parent tries to access unrelated student's report

**Manager/Principal Features:**
- Full access to all students and subclasses
- Can check availability for any student or subclass in the system
- Same response format as general endpoints

### Get Collection Analytics
```http
GET /api/v1/bursar/collection-analytics
Authorization: Bearer <token>
```

**Description:**
Retrieves analytics related to fee collection, including monthly trends and payment method breakdowns.
**Note:** This endpoint currently returns placeholder data; actual implementation is pending.

**Authorization:**
- `BURSAR`, `SUPER_MANAGER`, `PRINCIPAL`, `MANAGER`

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year if not provided.
  startDate?: string;    // Optional: "YYYY-MM-DD"
  endDate?: string;      // Optional: "YYYY-MM-DD"
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  message: "Collection analytics retrieved successfully";
  data: {
    monthlyTrends: Array<{
      month: string;
      collected: number;
      target: number;
      variance: number;
    }>;
    paymentMethods: Array<{
      method: string; // e.g., "EXPRESS_UNION", "CCA", "3DC"
      count: number;
      totalAmount: number;
    }>;
    collectionRate: number; // Overall collection rate
    targetVsActual: {
      target: number;
      actual: number;
      variance: number;
    };
  };
}
```

**Error Response (500):**
```typescript
{
  success: false;
  error: "Error fetching collection analytics: [error message]";
}
```

### Get Payment Trends
```http
GET /api/v1/bursar/payment-trends
Authorization: Bearer <token>
```

**Description:**
Retrieves analysis of payment trends over time, including daily collections and peak collection days.
**Note:** This endpoint currently returns placeholder data; actual implementation is pending.

**Authorization:**
- `BURSAR`, `SUPER_MANAGER`, `PRINCIPAL`, `MANAGER`

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year if not provided.
  period?: "daily" | "weekly" | "monthly" | "yearly"; // Optional: Period for aggregation. Defaults to "monthly".
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  message: "Payment trends retrieved successfully";
  data: {
    dailyCollections: Array<{
      date: string; // "YYYY-MM-DD"
      amount: number;
      transactionCount: number;
    }>;
    weeklySummary: Array<{
      week: string; // e.g., "Week 1", "2024-W1"
      totalAmount: number;
      averageDaily: number;
    }>;
    paymentMethodsBreakdown: Array<{
      method: string;
      totalAmount: number;
      transactionCount: number;
    }>;
    peakCollectionDays: Array<{
      date: string;
      amount: number;
    }>;
  };
}
```

**Error Response (500):**
```typescript
{
  success: false;
  error: "Error fetching payment trends: [error message]";
}
```

### Get Defaulters Report
```http
GET /api/v1/bursar/defaulters-report
Authorization: Bearer <token>
```

**Description:**
Generates a report of students with outstanding fee balances (defaulters) for the given academic year.

A student is treated as a defaulter when their aggregate outstanding balance across `SchoolFees` rows for the year (`amount_expected - amount_paid`) is greater than 0 (and, when `minimumAmount` is set, is ≥ `minimumAmount`).

**Authorization:**
- `BURSAR`, `SUPER_MANAGER`, `PRINCIPAL`, `MANAGER`

**Query Parameters:**
```typescript
{
  academicYearId?: number; // Optional: The ID of the academic year. Defaults to current year if not provided.
  minimumAmount?: number;  // Optional: Filter for students with outstanding balances greater than or equal to this amount.
  classId?: number;        // Optional: Filter for defaulters within a specific class.
  subClassId?: number;     // Optional: Filter for defaulters within a specific subclass.
  includeDetails?: boolean; // Optional: If true, each student row includes `contactParentPhone` (WhatsApp number preferred, phone fallback). Defaults to false.
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  message: "Defaulters report retrieved successfully";
  data: {
    totalDefaulters: number;
    totalOutstanding: number;
    byClass: Array<{
      classId: number | null;      // null if the enrollment has no class link (should not happen in normal data)
      className: string;
      defaultersCount: number;
      outstandingAmount: number;
    }>; // sorted by outstandingAmount desc
    byAmountRange: Array<{
      range: "0-10000" | "10001-50000" | "50001-100000" | "100000+";
      count: number;
      totalAmount: number;
    }>;
    students: Array<{ // Full list of defaulters, sorted by outstandingAmount desc
      studentId: number;
      studentName: string;
      matricule: string;
      className: string;
      subClassName: string;         // "Unassigned" if the student has no sub_class yet
      outstandingAmount: number;
      dueDate: string | null;       // ISO string of the oldest outstanding fee's due date
      daysOverdue: number;          // 0 if not yet due
      contactParentPhone?: string;  // Only present when includeDetails=true AND a parent phone exists
    }>;
  };
}
```

**Error Response (500):**
```typescript
{
  success: false;
  error: "Error fetching defaulters report: [error message]";
}
```

---

## Slack-Style Chat (`/chat`)

Slack-like workspace with department channels, subject channels, custom channels, direct messages, threaded replies, reactions, unread tracking, and real-time delivery over Socket.IO. All endpoints require `Authorization: Bearer <JWT>`.

**Auto-seeded channels (on server boot, idempotent):**
- One `DEPARTMENT` channel per Department (`ACADEMIC`, `DISCIPLINE`, `FINANCE`, `WELFARE`, `FRONT_OFFICE`, `EXECUTIVE`). Staff are auto-added based on their role's department.
- One `SUBJECT` channel per Subject that has an HOD. Members: HOD (as ADMIN) + all subject teachers.

**Channel types**: `DEPARTMENT` | `SUBJECT` | `CUSTOM` | `DIRECT`
**Member roles**: `MEMBER` | `ADMIN`

**Parent access rules**: Parents cannot join channels; they can only post in `DIRECT` channels, and only with staff whose role is in `PARENT_CONTACTABLE_ROLES` (`TEACHER`, `HOD`, `BURSAR`, `VICE_PRINCIPAL`, `DEAN_OF_STUDIES`, `GUIDANCE_COUNSELOR`, `PRINCIPAL`).

### `GET /chat/channels`
List all channels the current user is a member of, with unread counts and last message.

**Response 200:**
```typescript
{
  success: true;
  data: Array<{
    id: number;
    name: string;
    description: string | null;
    type: 'DEPARTMENT' | 'SUBJECT' | 'CUSTOM' | 'DIRECT';
    department: string | null;
    subject: { id: number; name: string } | null;
    isPrivate: boolean;
    isSystem: boolean;
    myRole: 'MEMBER' | 'ADMIN';
    muted: boolean;
    lastReadAt: string | null;
    unreadCount: number;
    lastMessage: { id: number; content: string; senderId: number; sender: {...}; createdAt: string } | null;
    memberCount: number;
    updatedAt: string;
  }>;
}
```

### `POST /chat/channels`
Create a custom channel. Not available to `PARENT` role.

**Request:**
```typescript
{
  name: string;                 // required
  description?: string;
  memberIds: number[];          // initial members (creator is added automatically as ADMIN)
  isPrivate?: boolean;
}
```

**Response 201:** created `ChatChannel` with members.

### `GET /chat/channels/:id`
Full channel details plus member list with roles.

### `GET /chat/channels/:id/messages`
Paginated message list for a channel (or a thread if `threadOf` is passed).

**Query parameters:**
- `before` (ISO date, optional) — return messages older than this
- `limit` (default 50, max 200)
- `threadOf` (message id) — when set, returns replies to that message

**Response 200:** array of `ChatMessage` in chronological order, each with `sender`, `attachments`, `reactions`, `_count.replies`.

### `POST /chat/channels/:id/messages`
Post a new message in a channel (or reply in a thread).

**Request:**
```typescript
{
  content: string;                    // required unless attachments present
  parentMessageId?: number | null;    // for thread replies
  attachments?: Array<{
    fileUrl: string;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
}
```

**Side effects:**
- Emits `message.new` over WebSocket to `channel:<id>` room.
- Creates in-app `MobileNotification` for every non-muted member except sender.

**Response 201:** created `ChatMessage`.

**403** if user is not a channel member, or is a `PARENT` posting outside a `DIRECT` channel.

### `PATCH /chat/messages/:id`
Edit a message (sender only). Sets `editedAt`. Emits `message.updated`.

**Request:** `{ content: string }`

### `DELETE /chat/messages/:id`
Soft-delete a message. Allowed for the sender or channel `ADMIN`. Emits `message.deleted`.

### `POST /chat/messages/:id/reactions`
Add an emoji reaction to a message. Idempotent (same user + same emoji is a no-op). Emits `reaction.added`.

**Request:** `{ emoji: string }` (e.g. `":+1:"` or an emoji character)

### `DELETE /chat/messages/:id/reactions/:emoji`
Remove the current user's reaction with the given emoji. Emits `reaction.removed`.

### `POST /chat/channels/:id/read`
Mark the channel as read up to a point in time.

**Request:** `{ upToMessageId?: number }` — if provided, uses that message's `createdAt`; otherwise uses "now".

**Response 200:** `{ success: true, data: { lastReadAt: string } }`. Emits `read.updated`.

### `POST /chat/channels/:id/members`
Add a member to a `CUSTOM` channel. Requires the caller to be an `ADMIN` in that channel. System channels (`DEPARTMENT`, `SUBJECT`) reject manual membership changes.

**Request:** `{ userId: number }`

Emits `member.joined` on the channel and `channel.created` to the new member.

### `DELETE /chat/channels/:id/members/:userId`
Remove a member from a channel, or leave the channel (`:userId` = self). System channels cannot be left. Emits `member.left`.

### `POST /chat/dm`
Open (or reuse) a direct-message channel with one or more users. If a DM channel with the exact same participants already exists, it is returned; otherwise a new one is created.

**Request:** `{ userIds: number[] }` (creator is added automatically)

**Parent-specific validation**: every counterpart must have a role in `PARENT_CONTACTABLE_ROLES` — otherwise 403.

**Response 200:** the DM `ChatChannel` with members. Also emits `channel.created` to every participant.

---

## WebSocket (Socket.IO)

**Endpoint:** `ws://<host>/socket.io`

**Handshake authentication** — send the JWT in either:
- `socket.handshake.auth.token`
- `Authorization: Bearer <token>` header

Blacklisted tokens are rejected. Invalid or missing tokens → connection refused with `unauthorized`.

**Automatic room membership on connect:**
- `user:<userId>` — personal room
- `channel:<channelId>` for every channel the user is a member of

**Client → server events:**
| Event | Payload | Effect |
|-------|---------|--------|
| `subscribe` | `{ channelId }` | Join a channel room (only if user is a member) |
| `unsubscribe` | `{ channelId }` | Leave a channel room |
| `typing` | `{ channelId }` | Broadcast to other members that user is typing |
| `presence` | (none) | Announce online status |

**Server → client events:**
| Event | Emitted when | Payload |
|-------|--------------|---------|
| `channel.created` | User is added to a new channel | full `ChatChannel` |
| `message.new` | Anyone posts in the channel | full `ChatMessage` |
| `message.updated` | A message is edited | full `ChatMessage` |
| `message.deleted` | A message is soft-deleted | `{ id, channelId }` |
| `reaction.added` | A reaction is added | `{ messageId, channelId, reaction }` |
| `reaction.removed` | A reaction is removed | `{ messageId, channelId, userId, emoji }` |
| `member.joined` | A member is added | `{ channelId, member }` |
| `member.left` | A member leaves/is removed | `{ channelId, userId }` |
| `read.updated` | Someone marks read | `{ channelId, userId, lastReadAt }` |
| `typing` | Peer is typing | `{ userId, channelId }` |
| `presence` | Peer connects/disconnects | `{ userId, status }` |

---

## Parent Contact Directory (`/parents/me/*`)

Curated staff directory endpoints for parents. Authorization: `PARENT` role.

### `GET /parents/me/contacts`
Returns three groups the parent can start a chat with.

**Response 200:**
```typescript
{
  success: true;
  data: {
    fixedStaff: Array<{ id, name, matricule, photo, userRoles: [...] }>;   // Principal, VP, Bursar, Dean of Studies
    childTeachers: Array<{
      id, name, matricule, photo, userRoles,
      teaches: Array<{ student: {id, name}, subject: {id, name}, subClass: {id, name} }>;
    }>;
    hodsBySubject: Array<{ subject: {id, name}, hod: {id, name, matricule, photo, userRoles} }>;
  };
}
```

### `POST /parents/me/contact/:userId`
Open (or reuse) a direct-message chat with a staff member.

**Response 200:** the `ChatChannel` — the parent then posts messages via `POST /chat/channels/:id/messages`.

**403** if the target user's role is not in `PARENT_CONTACTABLE_ROLES`.

---

## Report Requests (`/report-requests`) — Generalized

Previously restricted to `DEAN_OF_DISCIPLINE → SDM/DM`. As of 2026-07-21 the workflow is **reporting-chain-aware**: any senior can request a report from anyone below them in the hierarchy defined in `src/utils/roleHierarchy.ts` (`outranks()`).

- Requester's highest role must strictly outrank the recipient's highest role (lower `RoleTier` number).
- Cannot request from a `PARENT`.
- Cannot request from yourself.

**Route allow-lists** are broadened but the core authorization is inside the service. The endpoints, payloads, and status flow (`PENDING` → `SUBMITTED` → `REVIEWED` / `CANCELLED`) are unchanged.

Examples of newly-valid pairs:
- `VICE_PRINCIPAL` → `TEACHER` ✓
- `HOD` → `TEACHER` ✓
- `PRINCIPAL` → `BURSAR` ✓
- `TEACHER` → `VICE_PRINCIPAL` ✗ (403 — requester does not outrank recipient)

---

## Salary Management (`/salary`)

Two salary types:
- `TEACHER_HOURLY` — hourly rate × hours taught (from `TeacherPeriodAttendance`) + approved allowances/bonuses − approved withholdings.
- `ADMIN_FIXED` — flat `baseSalary` regardless of hours (constant month to month).

**Workflow:** `MANAGER` proposes profiles, rate changes, allowances, and withholdings **with a reason**; `SUPER_MANAGER` validates (approve/reject). `SUPER_MANAGER` may create or edit directly (auto-approved). Pay dates are auto-computed as the **last Friday** of the target month.

All requests/responses use **camelCase** (converted by middleware).

### Bursar Cash Visibility

#### `GET /api/v1/salary/bursar-cash/summary`
**Authorization:** `MANAGER`, `PRINCIPAL`, `SUPER_MANAGER`

**Query:** `academicYearId?: number` (defaults to current)

**Response 200:**
```typescript
{
  success: true,
  data: {
    academicYearId: number | null,
    collected: number,   // fee + control-fee + fee-item payments + cash injections
    spent: number,       // expenditures + refunds + paid salaries
    balance: number,     // collected - spent
    breakdown: {
      feePayments: number,
      controlFeePayments: number,
      feeItemPayments: number,
      cashInjections: number,
      expenditures: number,
      refunds: number,
      paidSalaries: number
    },
    paymentsByMethod: Array<{ paymentMethod: string, amount: number }>,
    expendituresByCategory: Array<{ category: string, amount: number }>,
    injectionsBySource: Array<{ source: string, amount: number }>
  }
}
```

#### `GET /api/v1/salary/bursar-cash/injections`
**Authorization:** `MANAGER`, `PRINCIPAL`, `SUPER_MANAGER`

**Query:** `academicYearId?`, `source?` (`MANAGER` | `SUPER_MANAGER` | `OTHER`), `page?`, `limit?`

**Response 200:** paginated list of `BursarCashInjection` records.

#### `POST /api/v1/salary/bursar-cash/injections`
**Authorization:** `MANAGER`, `SUPER_MANAGER`

Both roles can add cash to the bursar's account (top-ups, external cash receipts, etc). `source` is auto-set from the caller's role.

**Request:**
```typescript
{ amount: number, reason: string, reference?: string, academicYearId?: number }
```

**Response 201:** the created injection.

### Salary Profiles

One profile per user per academic year.

#### `POST /api/v1/salary/profiles`
**Authorization:** `MANAGER` (creates as `PENDING_APPROVAL`), `SUPER_MANAGER` (creates as `ACTIVE`)

**Request:**
```typescript
{
  userId: number,
  salaryType: 'TEACHER_HOURLY' | 'ADMIN_FIXED',
  hourlyRate?: number,   // required if TEACHER_HOURLY
  baseSalary?: number,   // required if ADMIN_FIXED
  academicYearId?: number,
  notes?: string
}
```

**Response 201:** the created profile.
**409** if a profile already exists for this user + year.

#### `GET /api/v1/salary/profiles`
**Authorization:** `MANAGER`, `PRINCIPAL`, `SUPER_MANAGER`

**Query:** `status?` (`PENDING_APPROVAL` | `ACTIVE` | `INACTIVE` | `REJECTED`), `salaryType?`, `academicYearId?`, `userId?`, `page?`, `limit?`

#### `GET /api/v1/salary/profiles/:id`
**Authorization:** `MANAGER`, `PRINCIPAL`, `SUPER_MANAGER`

#### `POST /api/v1/salary/profiles/:id/approve`
**Authorization:** `SUPER_MANAGER` — sets status to `ACTIVE`.

#### `POST /api/v1/salary/profiles/:id/reject`
**Authorization:** `SUPER_MANAGER`
**Request:** `{ reason: string }` — sets status to `REJECTED`.

#### `PATCH /api/v1/salary/profiles/:id/status`
**Authorization:** `SUPER_MANAGER`
**Request:** `{ status: 'ACTIVE' | 'INACTIVE' }` — manually toggle status (e.g., deactivate on offboarding).

### Salary Change Requests

Change `hourlyRate` (teachers) or `baseSalary` (admins) with a reason. Manager submits → `PENDING`; Super Manager approves → applied to profile.

#### `POST /api/v1/salary/change-requests`
**Authorization:** `MANAGER`, `SUPER_MANAGER`
**Request:**
```typescript
{
  salaryProfileId: number,
  newHourlyRate?: number,   // required for TEACHER_HOURLY profile
  newBaseSalary?: number,   // required for ADMIN_FIXED profile
  reason: string
}
```

#### `GET /api/v1/salary/change-requests`
**Query:** `status?`, `salaryProfileId?`, `page?`, `limit?`

#### `POST /api/v1/salary/change-requests/:id/approve`
**Authorization:** `SUPER_MANAGER` — applies the new rate/base to the underlying profile.

#### `POST /api/v1/salary/change-requests/:id/reject`
**Authorization:** `SUPER_MANAGER`
**Request:** `{ reason: string }`

### Salary Allowances / Bonuses

Two types: `ALLOWANCE` (recurring compensation add-on) and `BONUS`. Both need approval before they count toward a `SalaryPayment`.

#### `POST /api/v1/salary/allowances`
**Authorization:** `MANAGER`, `SUPER_MANAGER`
**Request:**
```typescript
{
  salaryProfileId: number,
  type: 'ALLOWANCE' | 'BONUS',
  amount: number,
  reason: string,
  payPeriodId?: number   // if omitted, applies to the next generated pay period
}
```

#### `GET /api/v1/salary/allowances`
**Query:** `status?`, `type?`, `salaryProfileId?`, `payPeriodId?`, `page?`, `limit?`

#### `POST /api/v1/salary/allowances/:id/approve`
**Authorization:** `SUPER_MANAGER`

#### `POST /api/v1/salary/allowances/:id/reject`
**Authorization:** `SUPER_MANAGER`
**Request:** `{ reason: string }`

### Pay Periods

One per (academicYearId, year, month). `payDate` is auto-computed as the last Friday of the month. Manager assigns which weeks of the month count toward teacher hours in `weekStartDates`.

#### `POST /api/v1/salary/pay-periods`
**Authorization:** `MANAGER`, `SUPER_MANAGER`
**Request:**
```typescript
{
  year: number,
  month: number,           // 1-12
  weekStartDates: string[], // ISO dates, e.g. ["2026-07-06","2026-07-13","2026-07-20","2026-07-27"]
  academicYearId?: number,
  notes?: string
}
```

#### `GET /api/v1/salary/pay-periods`
**Query:** `academicYearId?`, `status?` (`OPEN` | `LOCKED` | `PAID`), `year?`, `page?`, `limit?`

#### `GET /api/v1/salary/pay-periods/:id`

#### `PATCH /api/v1/salary/pay-periods/:id/weeks`
**Authorization:** `MANAGER`, `SUPER_MANAGER`
**Request:** `{ weekStartDates: string[] }` — cannot edit once period is `PAID`.

#### `POST /api/v1/salary/pay-periods/:id/generate`
**Authorization:** `MANAGER`, `SUPER_MANAGER`

Generates a `SalaryPayment` row per `ACTIVE` profile in the period's academic year. Teachers' hours are computed from `TeacherPeriod` schedule intersected with the assigned weeks and `TeacherPeriodAttendance`. Admins get their `baseSalary` flat. Idempotent: re-running overwrites `DRAFT`/`PENDING_PAYMENT` rows; `PAID` rows are preserved.

**Response 200:**
```typescript
{
  success: true,
  data: {
    payPeriodId: number,
    generated: number,
    payments: SalaryPayment[]
  }
}
```

#### `POST /api/v1/salary/pay-periods/:id/lock`
**Authorization:** `MANAGER`, `SUPER_MANAGER` — status → `LOCKED` (no more edits).

#### `POST /api/v1/salary/pay-periods/:id/mark-paid`
**Authorization:** `SUPER_MANAGER`

Marks the period `PAID` and flips every non-`PAID` payment in it to `PAID` (records `paidAt` and `paidById`).

#### `GET /api/v1/salary/pay-periods/:id/payments`
**Query:** `status?`, `userId?`, `page?`, `limit?`

Returns the generated `SalaryPayment` rows for the period, each with:
```typescript
{
  id: number,
  userId: number,
  salaryType: 'TEACHER_HOURLY' | 'ADMIN_FIXED',
  hoursExpected: number,
  hoursTaught: number,
  hoursAbsent: number,
  hourlyRate: number | null,
  baseAmount: number,
  allowanceTotal: number,
  bonusTotal: number,
  withheldAmount: number,
  netAmount: number,
  status: 'DRAFT' | 'PENDING_PAYMENT' | 'WITHHELD' | 'PAID',
  paidAt: string | null,
  ...user, payPeriod, salaryProfile, withholdings[]
}
```

#### `GET /api/v1/salary/payments/:id`
Returns a single `SalaryPayment` with related withholdings.

### Salary Withholdings

Withhold part or all of a payment with a reason. `scope`:
- `PARTIAL` — deduct `amount` from `netAmount`.
- `FULL` — deduct the entire current net (auto-filled by server).

Manager submits → `PENDING`; Super Manager approves → deducted from `netAmount`. If net drops to 0, payment `status` becomes `WITHHELD`.

#### `POST /api/v1/salary/withholdings`
**Authorization:** `MANAGER`, `SUPER_MANAGER`
**Request:**
```typescript
{
  salaryPaymentId: number,
  scope: 'PARTIAL' | 'FULL',
  amount?: number,   // required for PARTIAL; ignored for FULL
  reason: string
}
```

#### `GET /api/v1/salary/withholdings`
**Query:** `status?`, `salaryPaymentId?`, `page?`, `limit?`

#### `POST /api/v1/salary/withholdings/:id/approve`
**Authorization:** `SUPER_MANAGER`

#### `POST /api/v1/salary/withholdings/:id/reject`
**Authorization:** `SUPER_MANAGER`
**Request:** `{ reason: string }`

---

## Ream (Paper) Stock (`/reams`)

Central ledger of reams (RECEIPT / ISSUANCE). Managers and Super Managers see totals; Bursar and Secretary issue reams to a specific person with a reason.

### `GET /api/v1/reams/stock`
**Authorization:** `MANAGER`, `SUPER_MANAGER`, `PRINCIPAL`, `BURSAR`, `SECRETARY`

**Response 200:**
```typescript
{
  success: true,
  data: {
    currentStock: number,
    totalReceived: number,
    totalIssued: number,
    receiptCount: number,
    issuanceCount: number,
    lastEntry: ReamStockLedger | null
  }
}
```

### `GET /api/v1/reams/ledger`
**Authorization:** `MANAGER`, `SUPER_MANAGER`, `PRINCIPAL`, `BURSAR`, `SECRETARY`

**Query:** `type?` (`RECEIPT` | `ISSUANCE`), `recipientUserId?`, `fromDate?`, `toDate?`, `page?`, `limit?`

**Response 200:** paginated list of ledger entries with `recordedBy` and `recipient`.

### `POST /api/v1/reams/receipts`
**Authorization:** `MANAGER`, `SUPER_MANAGER`, `BURSAR`

Record stock coming in (purchased / delivered).
**Request:**
```typescript
{ quantity: number, notes?: string }
```

### `POST /api/v1/reams/issuances`
**Authorization:** `BURSAR`, `SECRETARY`

Issue reams to a specific person with a reason.
**Request:**
```typescript
{
  quantity: number,
  reason: string,
  recipientUserId?: number,   // preferred — links to a system user
  recipientName?: string,     // free-text fallback if recipient is external / not in system
  notes?: string
}
```
**409** if `quantity` exceeds `currentStock`.

---

## Notifications (`/notifications`)

Every notification carries workflow metadata so the frontend can badge, filter, and deep-link:

```typescript
{
  id: number,
  userId: number,          // recipient
  senderId: number | null, // who triggered it
  title: string | null,
  message: string,
  category: 'GENERAL' | 'ANNOUNCEMENT' | 'TASK_ASSIGNED' | 'TASK_UPDATE'
          | 'APPROVAL_NEEDED' | 'APPROVAL_APPROVED' | 'APPROVAL_REJECTED'
          | 'SALARY_UPDATE' | 'FEE_UPDATE' | 'DISCIPLINE' | 'SYSTEM',
  entityType: string | null,   // e.g. "SalaryAllowance", "Task", "SalaryChangeRequest"
  entityId: number | null,     // the source record's ID
  actionUrl: string | null,    // deep link the frontend can route to
  dateSent: string,
  readAt: string | null,
  status: 'SENT' | 'DELIVERED' | 'READ'
}
```

### `GET /api/v1/notifications/me`
List logged-in user's notifications.
**Query:** `?category=APPROVAL_NEEDED&entityType=SalaryAllowance&unreadOnly=true&status=SENT&page=1&limit=20`

### `GET /api/v1/notifications/me/unread-count`
```json
{ "success": true, "data": { "unread_count": 12 } }
```

### `GET /api/v1/notifications/me/unread-breakdown`
Grouped counts per category — for role-specific inbox badges.
```json
{
  "success": true,
  "data": {
    "total": 12,
    "by_category": [
      { "category": "APPROVAL_NEEDED", "count": 5 },
      { "category": "TASK_ASSIGNED", "count": 4 },
      { "category": "TASK_UPDATE", "count": 2 },
      { "category": "SYSTEM", "count": 1 }
    ]
  }
}
```

### `PUT /api/v1/notifications/:id/read`
Mark one as read (also records `read_at`). 403 if the notification belongs to a different user.

### `PUT /api/v1/notifications/mark-all-read`
Marks all of the user's notifications as read. Returns `{ markedCount }`.

### `DELETE /api/v1/notifications/:id`
Delete a single notification. 403 if not the owner.

### `POST /api/v1/notifications/send`   *(SUPER_MANAGER, MANAGER, PRINCIPAL, VICE_PRINCIPAL)*
Manual single-recipient send.
```json
{
  "recipientId": 42,
  "title": "Reminder",
  "message": "Please submit your termly report by Friday.",
  "category": "GENERAL",
  "entityType": "Report",
  "entityId": 7,
  "actionUrl": "/reports/7"
}
```

### `POST /api/v1/notifications/send-bulk`   *(SUPER_MANAGER, MANAGER, PRINCIPAL, VICE_PRINCIPAL)*
```json
{
  "recipientIds": [42, 43, 44],
  "title": "School closed tomorrow",
  "message": "The school will be closed on 2026-08-01.",
  "category": "ANNOUNCEMENT"
}
```

### Auto-triggered notifications

The salary and task workflows automatically emit notifications with populated `entityType` / `entityId` / `actionUrl`, so the UI can jump directly to the source item.

| Event | Recipient(s) | Category | entityType |
|---|---|---|---|
| Manager creates `SalaryProfile` | all SUPER_MANAGER | APPROVAL_NEEDED | SalaryProfile |
| SM approves/rejects profile | profile creator | APPROVAL_APPROVED / REJECTED | SalaryProfile |
| Manager creates `SalaryChangeRequest` | all SUPER_MANAGER | APPROVAL_NEEDED | SalaryChangeRequest |
| SM approves/rejects change | requester | APPROVAL_APPROVED / REJECTED | SalaryChangeRequest |
| Manager creates `SalaryAllowance` | all SUPER_MANAGER | APPROVAL_NEEDED | SalaryAllowance |
| SM approves/rejects allowance | requester | APPROVAL_APPROVED / REJECTED | SalaryAllowance |
| Manager creates `SalaryWithholding` | all SUPER_MANAGER | APPROVAL_NEEDED | SalaryWithholding |
| SM approves/rejects withholding | requester | APPROVAL_APPROVED / REJECTED | SalaryWithholding |
| Task assigned | assignee | TASK_ASSIGNED | Task |
| Assignee updates status/progress | task creator | TASK_UPDATE | Task |

---

## Tasks (`/tasks`)

Replaces the old mocked `POST /manager/tasks`. Real persistence + automatic notifications.

### `POST /api/v1/tasks`
**Roles:** SUPER_MANAGER, MANAGER, PRINCIPAL, VICE_PRINCIPAL, DEAN_OF_STUDIES, HOD, BURSAR, SENIOR_DISCIPLINE_MASTER, DEAN_OF_DISCIPLINE
```json
{
  "title": "Prepare Q3 supply audit",
  "description": "Full audit of consumable inventory.",
  "assignedToId": 42,
  "priority": "HIGH",
  "category": "ADMIN",
  "deadline": "2026-08-05T17:00:00.000Z",
  "notes": "Coordinate with the Bursar."
}
```
> `priority`: `LOW` | `MEDIUM` | `HIGH` | `URGENT` (default MEDIUM).
> On success the assignee receives a `TASK_ASSIGNED` notification.

**Response 201:** the created `Task` with `assignedTo` / `assignedBy` populated.

`POST /api/v1/manager/tasks` (from the manager namespace) also still works and now persists — supports an `assignedTo: number[]` array; one task is created per assignee.

### `GET /api/v1/tasks`
List. Any authenticated user.
**Query:**
| Param | Description |
|---|---|
| `mine=true` | Shortcut for `assignedToId = logged-in user`. |
| `assignedToId` | Filter by assignee. |
| `assignedById` | Filter by creator. |
| `status` | `PENDING` \| `IN_PROGRESS` \| `COMPLETED` \| `CANCELLED` |
| `priority` | `LOW` \| `MEDIUM` \| `HIGH` \| `URGENT` |
| `category` | Free-text label |
| `overdue=true` | Deadline in the past and not completed |
| `page`, `limit` | Pagination |

### `GET /api/v1/tasks/me/counters`
Small dashboard-badge helper.
```json
{ "success": true, "data": { "pending": 3, "in_progress": 2, "overdue": 1 } }
```

### `GET /api/v1/tasks/:id`

### `PATCH /api/v1/tasks/:id`
Permissions enforced in service:
- **Assignee** may update `status`, `progress` (0-100), `notes`.
- **Creator** and SUPER_MANAGER/PRINCIPAL may update any field.
- Setting `status = COMPLETED` auto-sets `progress = 100` and `completedAt = now()`.

```json
{ "status": "IN_PROGRESS", "progress": 60, "notes": "Half done, blocked on stock take" }
```
> When the assignee updates status or progress, the task creator receives a `TASK_UPDATE` notification.

### `DELETE /api/v1/tasks/:id`
Only the creator or a senior (SUPER_MANAGER / PRINCIPAL) may delete.

## Super Manager Overview (`/super-manager/overview`)

Read-only, chart-friendly aggregations for the SUPER_MANAGER dashboard. These endpoints do NOT expose write actions — they exist to give the SUPER_MANAGER at-a-glance oversight (counts, groupings, top-N lists) without needing to walk into each module's edit screens. Existing per-module write endpoints (fees, discipline, salary, etc.) are unchanged and remain restricted to the roles that own those workflows.

**Auth**: `Authorization: Bearer <JWT>`. Read access:
- `MANAGER`, `PRINCIPAL`, `SUPER_MANAGER` for all endpoints
- `SUPER_MANAGER`, `MANAGER` only for `/audit`

**Common query parameter** (accepted on every endpoint except `/tasks`, `/inventory`, `/ream-stock`, `/audit`):
| Param | Description |
|-------|-------------|
| `academicYearId` | Optional. Defaults to the current academic year. |

All responses follow: `{ "success": true, "data": { ...summary, ...breakdowns, "lastUpdated": "ISO-8601" } }`.

### `GET /api/v1/super-manager/overview/snapshot`
One-shot roll-up of every module's `summary` block. Ideal for the top-of-page KPI strip.
```json
{
  "success": true,
  "data": {
    "academicYearId": 5,
    "discipline":    { "totalIssues": 128, "issuesLast30Days": 22, "unexcusedLateness": 47, "unexcusedClassAbsences": 63, "activeWarnings": 9, "pendingParentSummons": 3, "pendingSaturdayPunishments": 4, "seizedItemsInCustody": 6, "rollCallsThisWeek": 84 },
    "attendance":    { "studentAttendanceRate": 96.4, "teacherAttendanceRateThisMonth": 92.1, "rollCallsThisMonth": 348, "teacherEvaluationsThisMonth": 210, "teacherAbsencesLast30Days": 14 },
    "academic":      { "totalExamSequences": 6, "openSequences": 1, "marksRecorded": 12894, "pendingReportCards": 32, "subjectSchemes": 55, "logbookEntriesLast7Days": 128 },
    "financial":     { "totalExpected": 82000000, "totalCollected": 61500000, "outstanding": 20500000, "collectionRate": 75.0, "paymentsLast7Days": 41, "totalExpendituresYTD": 14200000, "totalRefunds": 250000, "refundCount": 3, "pendingFinanceRequests": 2, "activeFeeItems": 18, "controlPaymentsRecorded": 512 },
    "staff":         { "totalUsers": 187, "totalTeachers": 62, "averageTeachingHours": 22.4, "newStaffThisMonth": 3, "teachersWithFullSchedule": 9 },
    "communication": { "totalAnnouncements": 24, "announcementsThisMonth": 4, "unreadNotifications": 88, "messagesLast7Days": 154, "chatMessagesLast7Days": 1240 },
    "health":        { "totalVisitsInYear": 322, "visitsThisMonth": 41, "visitsLast7Days": 12, "sentHomeThisMonth": 3, "studentsWithHealthConditions": 27 },
    "reamStock":     { "currentStock": 148, "totalReceived": 500, "totalIssued": 352, "receiptsLast30Days": 2, "reamsReceivedLast30Days": 60, "issuancesLast30Days": 18, "reamsIssuedLast30Days": 47 },
    "salary":        { "activeProfiles": 84, "pendingApprovalProfiles": 3, "pendingChangeRequests": 2, "pendingAllowances": 1, "pendingWithholdings": 0, "totalPayoutYear": 42000000, "totalWithheldYear": 350000, "totalPaymentsRecorded": 620, "cashInjectionsTotal": 500000, "cashInjectionsCount": 2, "latestPayPeriod": { "id": 11, "year": 2026, "month": 7, "payDate": "2026-07-31T00:00:00.000Z", "status": "OPEN" } },
    "tasks":         { "totalTasks": 96, "overdueTasks": 7, "completionRate": 63.5, "tasksCreatedLast30Days": 21, "tasksCompletedLast30Days": 17 },
    "inventory":     { "totalItems": 42, "activeItems": 38, "totalHoldings": 812, "distinctHoldings": 210, "pendingTransfers": 3, "ledgerEntriesLast30Days": 55 },
    "audit":         { "totalModificationsLast30Days": 2140, "distinctActiveUsersLast30Days": 34 },
    "enrollment":    { "totalEnrollments": 1120, "unassignedEnrollments": 4, "newEnrollmentsThisMonth": 12, "averageClassUtilization": 88.2, "assignmentRate": 99.64 },
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/discipline`
Discipline issues, warnings, summons, punishments, disciplinary actions, seized items, roll-call activity.
```json
{
  "success": true,
  "data": {
    "summary": { "totalIssues": 128, "issuesLast30Days": 22, "unexcusedLateness": 47, "unexcusedClassAbsences": 63, "activeWarnings": 9, "pendingParentSummons": 3, "pendingSaturdayPunishments": 4, "seizedItemsInCustody": 6, "rollCallsThisWeek": 84 },
    "issuesByType": [{ "type": "MORNING_LATENESS", "count": 47 }, { "type": "CLASS_ABSENCE", "count": 63 }],
    "disciplinaryActions": {
      "byType":   [{ "type": "SUSPENSION", "count": 4 }, { "type": "WORK_DUTY", "count": 9 }],
      "byStatus": [{ "status": "PENDING", "count": 2 }, { "status": "ACTIVE", "count": 6 }, { "status": "COMPLETED", "count": 5 }]
    },
    "seizedItemsByStatus": [{ "status": "IN_CUSTODY", "count": 6 }, { "status": "RELEASED", "count": 12 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/attendance`
Student and teacher attendance summaries (this-month bucketed for teachers; academic-year totals for student roll calls).
```json
{
  "success": true,
  "data": {
    "summary": { "studentAttendanceRate": 96.4, "teacherAttendanceRateThisMonth": 92.1, "rollCallsThisMonth": 348, "teacherEvaluationsThisMonth": 210, "teacherAbsencesLast30Days": 14 },
    "studentRollCallByStatus":   [{ "status": "PRESENT", "count": 9842 }, { "status": "ABSENT", "count": 340 }, { "status": "LATE", "count": 22 }],
    "teacherAttendanceByStatus": [{ "status": "PRESENT", "count": 194 }, { "status": "LATE", "count": 12 }, { "status": "ABSENT", "count": 4 }],
    "teacherRollCallByStatus":   [{ "status": "PRESENT", "count": 5200 }, { "status": "ABSENT", "count": 180 }, { "status": "LATE", "count": 44 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/academic`
Exam sequences, marks, generated report cards, subject schemes, logbook activity, student sequence-average statuses.
```json
{
  "success": true,
  "data": {
    "summary": { "totalExamSequences": 6, "openSequences": 1, "marksRecorded": 12894, "pendingReportCards": 32, "subjectSchemes": 55, "logbookEntriesLast7Days": 128 },
    "sequencesByStatus":         [{ "status": "OPEN", "count": 1 }, { "status": "CLOSED", "count": 4 }, { "status": "FINALIZED", "count": 1 }],
    "reportsByStatus":           [{ "status": "PENDING", "count": 32 }, { "status": "COMPLETED", "count": 240 }],
    "logbookByStatusLast30Days": [{ "status": "COMPLETED", "count": 610 }, { "status": "PARTIAL", "count": 18 }, { "status": "NOT_TAUGHT", "count": 5 }],
    "studentAveragesByStatus":   [{ "status": "PENDING", "count": 100 }, { "status": "CALCULATED", "count": 2410 }, { "status": "VERIFIED", "count": 1988 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/financial`
School-fees roll-up + expenditure/refund/finance-request/control-payment metrics.
```json
{
  "success": true,
  "data": {
    "summary": { "totalExpected": 82000000, "totalCollected": 61500000, "outstanding": 20500000, "collectionRate": 75.0, "paymentsLast7Days": 41, "totalExpendituresYTD": 14200000, "totalRefunds": 250000, "refundCount": 3, "pendingFinanceRequests": 2, "activeFeeItems": 18, "controlPaymentsRecorded": 512 },
    "paymentsByMethod":           [{ "method": "EXPRESS_UNION", "transactionCount": 210, "totalAmount": 32000000, "percentage": 52.03 }],
    "expendituresByCategoryYTD":  [{ "category": "SUPPLIES", "count": 41, "totalAmount": 4800000 }, { "category": "SALARY", "count": 6, "totalAmount": 8000000 }],
    "financeRequestsByStatus":    [{ "status": "PENDING", "count": 2 }, { "status": "APPROVED", "count": 15 }, { "status": "REJECTED", "count": 1 }, { "status": "COMPLETED", "count": 8 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/staff`
Users grouped by role and status, teacher hours summary, sub-class role assignments.
```json
{
  "success": true,
  "data": {
    "summary": { "totalUsers": 187, "totalTeachers": 62, "averageTeachingHours": 22.4, "newStaffThisMonth": 3, "teachersWithFullSchedule": 9 },
    "usersByRole":                 [{ "role": "TEACHER", "count": 62 }, { "role": "PARENT", "count": 84 }],
    "usersByStatus":               [{ "status": "ACTIVE", "count": 180 }, { "status": "INACTIVE", "count": 7 }],
    "subclassAssignmentsByRole":   [{ "role": "DISCIPLINE_MASTER", "count": 18 }, { "role": "HOD", "count": 9 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/communication`
Announcements + notification + messaging activity.
```json
{
  "success": true,
  "data": {
    "summary": { "totalAnnouncements": 24, "announcementsThisMonth": 4, "unreadNotifications": 88, "messagesLast7Days": 154, "chatMessagesLast7Days": 1240 },
    "announcementsByAudience":              [{ "audience": "INTERNAL", "count": 12 }, { "audience": "EXTERNAL", "count": 5 }, { "audience": "BOTH", "count": 7 }],
    "notificationsLast30DaysByCategory":    [{ "category": "TASK_ASSIGNED", "count": 41 }, { "category": "APPROVAL_NEEDED", "count": 22 }],
    "notificationsLast30DaysByStatus":      [{ "status": "SENT", "count": 60 }, { "status": "READ", "count": 200 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/health`
Nurse infirmary activity + top visit reasons.
```json
{
  "success": true,
  "data": {
    "summary": { "totalVisitsInYear": 322, "visitsThisMonth": 41, "visitsLast7Days": 12, "sentHomeThisMonth": 3, "studentsWithHealthConditions": 27 },
    "topReasonsLast30Days": [{ "reason": "headache", "count": 14 }, { "reason": "stomach ache", "count": 9 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/ream-stock`
Ream (paper) ledger snapshot. Accepts no query params.
```json
{
  "success": true,
  "data": {
    "summary": { "currentStock": 148, "totalReceived": 500, "totalIssued": 352, "receiptsLast30Days": 2, "reamsReceivedLast30Days": 60, "issuancesLast30Days": 18, "reamsIssuedLast30Days": 47 },
    "topRecipientsLast90Days": [{ "recipientUserId": 12, "recipientName": null, "reamsIssued": 15 }, { "recipientUserId": null, "recipientName": "External print house", "reamsIssued": 8 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/salary`
Salary profiles / change-requests / allowances / withholdings / pay-period activity + bursar cash injections.
```json
{
  "success": true,
  "data": {
    "summary": {
      "activeProfiles": 84, "pendingApprovalProfiles": 3, "pendingChangeRequests": 2, "pendingAllowances": 1, "pendingWithholdings": 0,
      "totalPayoutYear": 42000000, "totalWithheldYear": 350000, "totalPaymentsRecorded": 620,
      "cashInjectionsTotal": 500000, "cashInjectionsCount": 2,
      "latestPayPeriod": { "id": 11, "year": 2026, "month": 7, "payDate": "2026-07-31T00:00:00.000Z", "status": "OPEN" }
    },
    "profilesByStatus":      [{ "status": "ACTIVE", "count": 84 }, { "status": "PENDING_APPROVAL", "count": 3 }],
    "profilesByType":        [{ "type": "TEACHER_HOURLY", "count": 62 }, { "type": "ADMIN_FIXED", "count": 25 }],
    "payPeriodsByStatus":    [{ "status": "OPEN", "count": 1 }, { "status": "LOCKED", "count": 3 }, { "status": "PAID", "count": 7 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/tasks`
Task activity across the whole school. No query params.
```json
{
  "success": true,
  "data": {
    "summary": { "totalTasks": 96, "overdueTasks": 7, "completionRate": 63.5, "tasksCreatedLast30Days": 21, "tasksCompletedLast30Days": 17 },
    "tasksByStatus":   [{ "status": "PENDING", "count": 20 }, { "status": "IN_PROGRESS", "count": 15 }, { "status": "COMPLETED", "count": 61 }],
    "tasksByPriority": [{ "priority": "LOW", "count": 30 }, { "priority": "MEDIUM", "count": 50 }, { "priority": "HIGH", "count": 12 }, { "priority": "URGENT", "count": 4 }],
    "tasksByCategory": [{ "category": "GENERAL", "count": 45 }, { "category": "MAINTENANCE", "count": 22 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/inventory`
Personnel inventory catalog + holdings + transfers. No query params.
```json
{
  "success": true,
  "data": {
    "summary": { "totalItems": 42, "activeItems": 38, "totalHoldings": 812, "distinctHoldings": 210, "pendingTransfers": 3, "ledgerEntriesLast30Days": 55 },
    "transfersByStatus":    [{ "status": "PENDING", "count": 3 }, { "status": "ACCEPTED", "count": 44 }],
    "topItemsByQuantity":   [{ "itemId": 5, "name": "Chalk", "unit": "box", "totalQuantity": 240 }, { "itemId": 9, "name": "A4 Paper", "unit": "ream", "totalQuantity": 148 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/audit`
Audit log activity over the last 30 days. **SUPER_MANAGER / MANAGER only.** No query params.
```json
{
  "success": true,
  "data": {
    "summary": { "totalModificationsLast30Days": 2140, "distinctActiveUsersLast30Days": 34 },
    "actionsLast30Days":         [{ "action": "CREATE", "count": 900 }, { "action": "UPDATE", "count": 1100 }, { "action": "DELETE", "count": 140 }],
    "topTablesLast30Days":       [{ "table": "Mark", "count": 640 }, { "table": "PaymentTransaction", "count": 210 }],
    "topActiveUsersLast30Days":  [{ "userId": 7, "name": "Alice Ngu", "matricule": "ST00007", "actions": 380 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### `GET /api/v1/super-manager/overview/enrollment`
Enrollment counts, class utilization, gender split, students by status.
```json
{
  "success": true,
  "data": {
    "summary": { "totalEnrollments": 1120, "unassignedEnrollments": 4, "newEnrollmentsThisMonth": 12, "averageClassUtilization": 88.2, "assignmentRate": 99.64 },
    "classUtilization":  [{ "classId": 1, "className": "Form 1", "maxStudents": 200, "currentStudents": 184, "utilizationRate": 92.0 }],
    "genderSplit":       [{ "gender": "Male", "count": 580 }, { "gender": "Female", "count": 540 }],
    "studentsByStatus":  [{ "status": "ENROLLED", "count": 1120 }, { "status": "NOT_ENROLLED", "count": 6 }],
    "lastUpdated": "2026-08-01T09:15:22.000Z"
  }
}
```

### Frontend integration notes
- All endpoints are safe to call together — they are independent reads. The `snapshot` endpoint does exactly that server-side.
- For chart widgets: use each `summary` block for KPI cards; use the array-shaped fields (`*ByStatus`, `*ByType`, `*ByCategory`, `topItemsByQuantity`, `topRecipientsLast90Days`, `topActiveUsersLast30Days`, `classUtilization`, `paymentsByMethod`, `expendituresByCategoryYTD`) as direct inputs to bar / pie / doughnut charts.
- `lastUpdated` is always ISO-8601 UTC — use it for cache-busting or a "refreshed X seconds ago" label.
- SUPER_MANAGER retains full write access to the underlying modules; these endpoints are additive.

