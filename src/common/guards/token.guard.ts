// import {
//   CanActivate,
//   ExecutionContext,
//   Injectable,
//   UnauthorizedException,
// } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { JwtService } from '@nestjs/jwt';
// import { jekRoles } from '@prisma/client';
// import { PrismaService } from 'src/core/database/prisma.service';

// @Injectable()
// export class TokenGuard implements CanActivate {
//   constructor(
//     private config: ConfigService,
//     private jwt: JwtService,
//     private prisma: PrismaService,
//   ) { }

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const req = context.switchToHttp().getRequest();
//     let authHeader = req.headers.authorization;
//     let token = '';

//     if (authHeader?.startsWith('Bearer ')) {
//       token = authHeader.split(' ')[1];
//     } else if (req.query.token) {
//       token = req.query.token as string;
//     }

//     if (!token) {
//       throw new UnauthorizedException('Token topilmadi');
//     }

//     try {
//       const payload = await this.jwt.verifyAsync(token, {
//         secret: this.config.get('JWT_ACCESS_SECRET'),
//       });

//       let user: any = null;

//       if (payload.role === jekRoles.User) {
//         user = await this.prisma.users.findUnique({
//           where: { id: payload.id },
//           select: { id: true, role: true, phoneNumber: true },
//         });
//       } else {
//         // Id orqali bazadan kerakli malumotlarni o'qiymiz (district ham kerak)
//         user = await this.prisma.admins.findUnique({
//           where: { id: payload.id },
//           select: {
//             id: true,
//             role: true,
//             isActive: true,
//             addresses: {
//               include: {
//                 address: true
//               }
//             }
//           } as any,
//         });
//       }

//       if (!user) throw new UnauthorizedException('Foydalanuvchi topilmadi');
//       if (user.isActive === false) throw new UnauthorizedException('Akkauntingiz faollashtirilmagan');

//       req['user'] = user;
//       return true;
//     } catch (e) {
//       throw new UnauthorizedException(e.message || 'Token yaroqsiz');
//     }
//   }
// }
