// import {
//   CanActivate,
//   ExecutionContext,
//   ForbiddenException,
//   Injectable,
// } from '@nestjs/common';
// import { Reflector } from '@nestjs/core';
// import { jekRoles } from '@prisma/client';
// @Injectable()
// export class RoleGuard implements CanActivate {
//   constructor(private reflector: Reflector) { }
//   canActivate(context: ExecutionContext): boolean {
//     const Roles = this.reflector.getAllAndOverride<jekRoles[]>('roles', [
//       context.getHandler(),
//       context.getClass(),
//     ]);
//     if (!Roles) {
//       return true;
//     }

//     const req = context.switchToHttp().getRequest();
//     const user = req.user;

//     if (!user) {
//       throw new ForbiddenException('Foydalanuvchi aniqlanmadi');
//     }

//     if (user.isDeleted) {
//       throw new ForbiddenException("Hisobingiz o'chirilgan yoki faol emas.");
//     }

//     if (Roles.includes(user.role)) {
//       return true;
//     }

//     throw new ForbiddenException('Sizda bunday huquq mavjud emas');
//   }
// }

// import {
//   CanActivate,
//   ExecutionContext,
//   ForbiddenException,
//   Injectable,
// } from '@nestjs/common';
// import { Reflector } from '@nestjs/core';
// import { jekRoles } from '@prisma/client';

// @Injectable()
// export class RoleGuard implements CanActivate {
//   constructor(private reflector: Reflector) { }

//   canActivate(context: ExecutionContext): boolean {
//     const requiredRoles = this.reflector.getAllAndOverride<jekRoles[]>(
//       'roles',
//       [context.getHandler(), context.getClass()],
//     );

//     if (!requiredRoles) return true;

//     const req = context.switchToHttp().getRequest();
//     const user = req.user;

//     const isInactiveAllowed = this.reflector.getAllAndOverride<boolean>(
//       'allow_inactive',
//       [context.getHandler(), context.getClass()],
//     );

//     if (!user) throw new ForbiddenException('Ruxsat berilmadi');

//     if (
//       user.role !== jekRoles.User &&
//       user.isActive === false &&
//       !isInactiveAllowed
//     ) {
//       throw new ForbiddenException('Sizning hisobingiz hali faol emas');
//     }

//     const hasRole = requiredRoles.includes(user.role);
//     if (!hasRole) {
//       throw new ForbiddenException('Sizda ushbu amal uchun ruxsat yo‘q');
//     }

//     return true;
//   }
// }
