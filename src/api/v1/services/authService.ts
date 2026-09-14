// src/api/v1/services/authService.ts
import { PrismaClient, User, Role, Gender, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { generateToken } from '../../../config/auth';
import prisma from '../../../config/db';
import { generateStaffMatricule } from '../../../utils/matriculeGenerator';
import { getAcademicYearId } from '../../../utils/academicYear';

interface LoginCredentials {
    email?: string;
    matricule?: string;
    phone?: string;
    password: string;
}

// Cameroon mobiles are 9 digits; some records store them with a "237" country
// code prefix. We compare on the trailing 9 digits so both formats match.
const normalizePhoneDigits = (raw: string): string => {
    const digits = raw.replace(/\D/g, '');
    return digits.length > 9 ? digits.slice(-9) : digits;
};

// Define user registration data interface
interface UserRegistrationData {
    name: string;
    email: string;
    password: string;
    gender: "Male" | "Female";
    date_of_birth: string;
    phone: string;
    address: string;
    id_card_num?: string;
    photo?: string;
    status?: UserStatus;
}

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

const TOKEN_EXPIRY = '120d';

/**
 * Logs a user in.
 * @param credentials - The user's login credentials (email or matricule, and password).
 * @returns The JWT token and user data.
 */
export const login = async (credentials: LoginCredentials): Promise<any> => {
    const { email, matricule, phone, password } = credentials;

    if (!password || (!email && !matricule && !phone)) {
        throw new Error('Email, phone, or matricule and password are required');
    }

    let user: (User & { user_roles: { role: Role; academic_year_id: number | null }[] }) | null | undefined;
    if (email) {
        user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            include: { user_roles: true },
        });
    } else if (matricule) {
        user = await prisma.user.findUnique({
            where: { matricule: matricule.toUpperCase() },
            include: { user_roles: true },
        });
    } else {
        // Phone login: staff only (parents share phones, so keep them on matricule).
        // Compare on the last 9 digits so "+237" and bare formats both match.
        const target = normalizePhoneDigits(phone!);
        if (target.length < 8) {
            throw new Error('Invalid phone number');
        }
        const candidates = await prisma.user.findMany({
            where: {
                phone: { endsWith: target },
                user_roles: { some: { role: { not: Role.PARENT } } },
            },
            include: { user_roles: true },
        });
        const staffMatches = candidates.filter(
            (u) => normalizePhoneDigits(u.phone) === target,
        );
        if (staffMatches.length > 1) {
            throw new Error('Multiple accounts share this phone number. Please sign in with your email.');
        }
        user = staffMatches[0];
    }

    if (!user) {
        console.error(`Login failed: User not found with identifier - ${email || phone || matricule}`);
        throw new Error('User not found');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
        console.error(`Login failed: Password mismatch for user ${user.email}`);
        throw new Error('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
        throw new Error('User account is not active');
    }

    // Get unique roles only (user might have same role across multiple academic years)
    const userActiveRoles = [...new Set(user.user_roles.map(ur => ur.role))];

    // Matricule login is restricted to parent accounts. Every parent has their
    // own matricule and their own notification channel, so we keep matricule
    // as the parent-only sign-in path. Staff/students must sign in by email.
    if (matricule && !email) {
        if (!userActiveRoles.includes(Role.PARENT)) {
            throw new Error('Matricule login is only available for parent accounts. Please sign in with your email instead.');
        }
    }

    const token = generateToken({ id: user.id, roles: userActiveRoles });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userWithoutPassword } = user;

    return {
        token,
        expiresIn: '120d',
        user: userWithoutPassword,
        must_change_password: user.must_change_password === true,
    };
};

/**
 * Registers a new user.
 * @param userData - User registration data
 * @returns The newly created user.
 */
export const register = async (userData: UserRegistrationData): Promise<User> => {
    console.log('Registration data received:', userData);
    
    const {
        name,
        email,
        password,
        gender,
        date_of_birth: dateOfBirth,
        phone,
        address,
        id_card_num: idCardNum,
        photo,
        status,
    } = userData;

    // Validate required fields
    if (!password) {
        throw new Error('Password is required');
    }
    if (!name) {
        throw new Error('Name is required');
    }
    if (!email) {
        throw new Error('Email is required');
    }
    if (!gender) {
        throw new Error('Gender is required');
    }
    if (!dateOfBirth) {
        throw new Error('Date of birth is required');
    }
    if (!address) {
        throw new Error('Address is required');
    }

    console.log('Password received:', password ? 'YES' : 'NO');

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({ where: { email: email?.toLowerCase() } });
    if (existingUser) {
        throw new Error('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate matricule for the default PARENT role
    const matricule = await generateStaffMatricule([Role.PARENT]);

    // Get current academic year for role assignment tracking
    const currentAcademicYearId = await getAcademicYearId();
    if (!currentAcademicYearId) {
        throw new Error('No academic year found. Please ensure at least one academic year exists.');
    }

    const createdUser = await prisma.user.create({
        data: {
            name,
            email: email?.toLowerCase(),
            password: hashedPassword,
            gender: gender,
            date_of_birth: new Date(dateOfBirth),
            phone,
            address,
            matricule, // Add the generated matricule
            ...(idCardNum && { id_card_num: idCardNum }),
            ...(photo && { photo }),
            status: status || 'ACTIVE',
            user_roles: {
                create: [{
                    role: Role.PARENT,
                    academic_year_id: currentAcademicYearId // Track when role was assigned
                }],
            },
        },
        include: {
            user_roles: true,
        },
    });

    return createdUser;
};

/**
 * Change the password of an authenticated user.
 * Normally requires the current password. If the account is flagged
 * `must_change_password` (default parents, bursar-created accounts), the
 * caller may omit currentPassword — this is the mandatory first-login
 * change flow. After a successful change the flag is cleared.
 */
export const changePassword = async (
    userId: number,
    currentPassword: string | undefined,
    newPassword: string
): Promise<void> => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new Error('User not found');
    }

    const isForcedFirstLogin = user.must_change_password === true;

    if (!isForcedFirstLogin) {
        if (!currentPassword) {
            throw new Error('Current password is required');
        }
        const passwordMatch = await bcrypt.compare(currentPassword, user.password);
        if (!passwordMatch) {
            throw new Error('Current password is incorrect');
        }
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, user.password);
    if (sameAsCurrent) {
        throw new Error('New password must be different from the current password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
        where: { id: userId },
        data: {
            password: hashedPassword,
            must_change_password: false,
        },
    });
};

/**
 * Get user profile by ID
 * @param userId - User ID
 * @returns User data
 */
export async function getProfile(userId: number) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            user_roles: true
        }
    });

    if (!user) {
        return null;
    }

    // Return user data (excluding password)
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
}
