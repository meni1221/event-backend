import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { CurrentHost } from '../../../common/decorators/current-host';
import { ApiProtectedOperation } from '../../../common/swagger/operations';
import { CreateEventDto } from '../dto/create-event';
import { UpdateEventDto } from '../dto/update-event';
import { UpdateSeatingDto } from '../dto/update-seating';
import { EventsService } from '../service';

@ApiTags('Events')
@ApiBearerAuth('access-token')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiProtectedOperation('List events owned by the current host')
  findAll(@CurrentHost() host: { hostId: string }) {
    return this.eventsService.findAll(host.hostId);
  }

  @Post()
  @ApiProtectedOperation('Create an event owned by the current host')
  @HttpCode(StatusCodes.CREATED)
  create(@CurrentHost() host: { hostId: string }, @Body() dto: CreateEventDto) {
    return this.eventsService.create(host.hostId, dto);
  }

  @Get(':eventId/seating')
  @ApiProtectedOperation('Get the seating plan for an owned event')
  getSeating(@CurrentHost() host: { hostId: string }, @Param('eventId') eventId: string) {
    return this.eventsService.getSeating(host.hostId, eventId);
  }

  @Put(':eventId/seating')
  @ApiProtectedOperation('Replace and validate the seating plan for an owned event')
  @HttpCode(StatusCodes.OK)
  updateSeating(
    @CurrentHost() host: { hostId: string },
    @Param('eventId') eventId: string,
    @Body() dto: UpdateSeatingDto,
  ) {
    return this.eventsService.updateSeating(host.hostId, eventId, dto);
  }

  @Patch(':eventId')
  @ApiProtectedOperation('Update an owned event')
  @HttpCode(StatusCodes.OK)
  update(
    @CurrentHost() host: { hostId: string },
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(host.hostId, eventId, dto);
  }

  @Delete(':eventId')
  @ApiProtectedOperation('Delete an owned event and its guests')
  @HttpCode(StatusCodes.OK)
  remove(@CurrentHost() host: { hostId: string }, @Param('eventId') eventId: string) {
    return this.eventsService.remove(host.hostId, eventId);
  }
}
