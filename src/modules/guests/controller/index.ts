import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { Throttle } from '@nestjs/throttler';
import { CurrentHost } from '../../../common/decorators/current-host';
import { Public } from '../../../common/decorators/public';
import { routeRateLimits } from '../../../common/security';
import { CreateGuestDto } from '../dto/create-guest';
import { UpdateGuestDto } from '../dto/update-guest';
import { UpdateRsvpDto } from '../dto/update-rsvp';
import { GuestsService } from '../service';

@ApiTags('Guests')
@Controller('guests')
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get()
  @ApiBearerAuth('access-token')
  findHostGuests(@CurrentHost() host: { hostId: string }) {
    return this.guestsService.findByHost(host.hostId);
  }

  @Post('event/:eventId')
  @HttpCode(StatusCodes.CREATED)
  @ApiBearerAuth('access-token')
  createGuest(
    @CurrentHost() host: { hostId: string },
    @Param('eventId') eventId: string,
    @Body() dto: CreateGuestDto,
  ) {
    return this.guestsService.createForEvent(host.hostId, eventId, dto);
  }

  @Delete(':guestId')
  @HttpCode(StatusCodes.OK)
  @ApiBearerAuth('access-token')
  removeGuest(@CurrentHost() host: { hostId: string }, @Param('guestId') guestId: string) {
    return this.guestsService.remove(host.hostId, guestId);
  }

  @Patch(':guestId')
  @HttpCode(StatusCodes.OK)
  @ApiBearerAuth('access-token')
  updateGuest(
    @CurrentHost() host: { hostId: string },
    @Param('guestId') guestId: string,
    @Body() dto: UpdateGuestDto,
  ) {
    return this.guestsService.update(host.hostId, guestId, dto);
  }

  @Get('invite/:eventId/:inviteId')
  @Public()
  @Throttle(routeRateLimits.invitations.read)
  findPublicInviteByEvent(
    @Param('eventId') eventId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.guestsService.findByEventInviteId(eventId, inviteId);
  }

  @Get('invite/:inviteId')
  @Public()
  @Throttle(routeRateLimits.invitations.read)
  findPublicInvite(@Param('inviteId') inviteId: string) {
    return this.guestsService.findByInviteId(inviteId);
  }

  @Patch('invite/:eventId/:inviteId/rsvp')
  @Public()
  @Throttle(routeRateLimits.invitations.rsvp)
  @HttpCode(StatusCodes.OK)
  updatePublicEventRsvp(
    @Param('eventId') eventId: string,
    @Param('inviteId') inviteId: string,
    @Body() dto: UpdateRsvpDto,
  ) {
    return this.guestsService.updateRsvp(inviteId, dto, eventId);
  }

  @Patch('invite/:inviteId/rsvp')
  @Public()
  @Throttle(routeRateLimits.invitations.rsvp)
  @HttpCode(StatusCodes.OK)
  updatePublicRsvp(@Param('inviteId') inviteId: string, @Body() dto: UpdateRsvpDto) {
    return this.guestsService.updateRsvp(inviteId, dto);
  }
}
