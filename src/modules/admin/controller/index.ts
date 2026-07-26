import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { CurrentHost } from '../../../common/decorators/current-host';
import { ApiOwnerOperation, ApiProtectedOperation } from '../../../common/swagger/operations';
import { ChangePasswordDto, UpdateAdminOnboardingDto, UpdateAdminProfileDto } from '../dto';
import { AdminRole } from '../schemas';
import { AdminService } from '../service';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Delete('me')
  @ApiProtectedOperation('Permanently delete the current host and owned data')
  @HttpCode(StatusCodes.OK)
  deleteCurrentHost(@CurrentHost() host: { hostId: string }) {
    return this.adminService.deleteHostData(host.hostId);
  }

  @Get('me/profile')
  @ApiProtectedOperation('Get the current admin profile')
  getCurrentProfile(@CurrentHost() host: { hostId: string }) {
    return this.adminService.getCurrentProfile(host.hostId);
  }

  @Patch('me/profile')
  @ApiProtectedOperation('Update the current admin profile')
  @HttpCode(StatusCodes.OK)
  updateCurrentProfile(@CurrentHost() host: { hostId: string }, @Body() dto: UpdateAdminProfileDto) {
    return this.adminService.updateCurrentProfile(host.hostId, dto);
  }

  @Patch('me/onboarding')
  @ApiProtectedOperation('Update onboarding completion state')
  @HttpCode(StatusCodes.OK)
  updateCurrentOnboarding(@CurrentHost() host: { hostId: string }, @Body() dto: UpdateAdminOnboardingDto) {
    return this.adminService.updateCurrentOnboarding(host.hostId, dto);
  }

  @Patch('me/password')
  @ApiProtectedOperation('Change the current admin password and revoke older sessions')
  @HttpCode(StatusCodes.OK)
  changeCurrentPassword(@CurrentHost() host: { hostId: string }, @Body() dto: ChangePasswordDto) {
    return this.adminService.changeCurrentPassword(host.hostId, dto);
  }

  @Get('overview')
  @ApiOwnerOperation('Get the owner overview of hosts and events')
  getOwnerOverview(@CurrentHost() host: { role?: AdminRole }) {
    if (host.role !== AdminRole.OWNER) {
      throw new ForbiddenException('Owner access is required');
    }

    return this.adminService.getOwnerOverview();
  }

  @Patch(':adminId/approve')
  @ApiOwnerOperation('Approve a pending host account')
  @HttpCode(StatusCodes.OK)
  approveHost(@CurrentHost() host: { role?: AdminRole }, @Param('adminId') adminId: string) {
    if (host.role !== AdminRole.OWNER) {
      throw new ForbiddenException('Owner access is required');
    }

    return this.adminService.approveHost(adminId);
  }

  @Patch(':adminId/suspend')
  @ApiOwnerOperation('Suspend a host account and revoke its sessions')
  @HttpCode(StatusCodes.OK)
  suspendHost(@CurrentHost() host: { role?: AdminRole }, @Param('adminId') adminId: string) {
    if (host.role !== AdminRole.OWNER) {
      throw new ForbiddenException('Owner access is required');
    }

    return this.adminService.suspendHost(adminId);
  }

  @Patch(':adminId/restore')
  @ApiOwnerOperation('Restore a suspended host account')
  @HttpCode(StatusCodes.OK)
  restoreHost(@CurrentHost() host: { role?: AdminRole }, @Param('adminId') adminId: string) {
    if (host.role !== AdminRole.OWNER) {
      throw new ForbiddenException('Owner access is required');
    }

    return this.adminService.restoreHost(adminId);
  }
}
