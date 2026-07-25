import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { CurrentHost } from '../../../common/decorators/current-host';
import { ChangePasswordDto, UpdateAdminOnboardingDto, UpdateAdminProfileDto } from '../dto';
import { AdminRole } from '../schemas';
import { AdminService } from '../service';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Delete('me')
  @HttpCode(StatusCodes.OK)
  deleteCurrentHost(@CurrentHost() host: { hostId: string }) {
    return this.adminService.deleteHostData(host.hostId);
  }

  @Get('me/profile')
  getCurrentProfile(@CurrentHost() host: { hostId: string }) {
    return this.adminService.getCurrentProfile(host.hostId);
  }

  @Patch('me/profile')
  @HttpCode(StatusCodes.OK)
  updateCurrentProfile(@CurrentHost() host: { hostId: string }, @Body() dto: UpdateAdminProfileDto) {
    return this.adminService.updateCurrentProfile(host.hostId, dto);
  }

  @Patch('me/onboarding')
  @HttpCode(StatusCodes.OK)
  updateCurrentOnboarding(@CurrentHost() host: { hostId: string }, @Body() dto: UpdateAdminOnboardingDto) {
    return this.adminService.updateCurrentOnboarding(host.hostId, dto);
  }

  @Patch('me/password')
  @HttpCode(StatusCodes.OK)
  changeCurrentPassword(@CurrentHost() host: { hostId: string }, @Body() dto: ChangePasswordDto) {
    return this.adminService.changeCurrentPassword(host.hostId, dto);
  }

  @Get('overview')
  getOwnerOverview(@CurrentHost() host: { role?: AdminRole }) {
    if (host.role !== AdminRole.OWNER) {
      throw new ForbiddenException('Owner access is required');
    }

    return this.adminService.getOwnerOverview();
  }

  @Patch(':adminId/approve')
  @HttpCode(StatusCodes.OK)
  approveHost(@CurrentHost() host: { role?: AdminRole }, @Param('adminId') adminId: string) {
    if (host.role !== AdminRole.OWNER) {
      throw new ForbiddenException('Owner access is required');
    }

    return this.adminService.approveHost(adminId);
  }
}
